import { decide } from "../agents/index.js";
import type { SimConfig } from "./config.js";
import { Rng } from "./rng.js";
import { computeMetrics } from "./metrics.js";
import {
  clearResourceMarket,
  updatePrice,
  SYSTEM_ID,
  type ClearingOrder,
} from "./markets.js";
import { seedColony, formatAgentId } from "./state.js";
import type { Intent } from "./intents.js";
import type {
  Agent,
  ColonyMetrics,
  ColonyState,
  Debt,
  EngineEvent,
  EventType,
  Job,
  ResourceKind,
  Trade,
} from "./types.js";
import { RESOURCE_KINDS } from "./types.js";

export type EventSink = (event: EngineEvent) => void;

export interface TickResult {
  metrics: ColonyMetrics;
  events: EngineEvent[];
  trades: Trade[];
}

/**
 * The deterministic economic engine. One `step()` = one tick = the 8-stage
 * loop from the spec. The engine is the ONLY thing that mutates state; agents
 * merely express intents. Given the same seed and config, step-by-step history
 * is identical (replayable, verifiable).
 */
export class Engine {
  readonly config: SimConfig;
  readonly state: ColonyState;
  private readonly rng: Rng;
  private readonly sinks: EventSink[] = [];

  constructor(config: SimConfig) {
    this.config = config;
    this.rng = new Rng(config.seed);
    this.state = seedColony(config, this.rng);
    // Announce the genesis population.
    for (const a of this.state.agents.values()) {
      this.emitDeferred("agent_born", { id: a.id, wallet: a.wallet, tier: a.disposition.tier });
    }
  }

  onEvent(sink: EventSink): void {
    this.sinks.push(sink);
  }

  /**
   * Dynamically spawn a new agent into the running simulation.
   * The agent enters on the NEXT tick with a fresh wallet and specified
   * disposition. Returns the new agent ID.
   */
  spawnAgent(opts: {
    name?: string;
    thrift?: number;
    acquisitiveness?: number;
    creditAppetite?: number;
    tier?: 0 | 1;
    wallet?: number;
  } = {}): string {
    const cfg = this.config;
    const s = this.state;
    const id = "a" + (s.nextIds.agent * 2654435761 % 0xffff).toString(16).padStart(4, "0");
    s.nextIds.agent++;

    const tier: 0 | 1 = opts.tier ?? 0;
    const agent: Agent = {
      id,
      name: opts.name,
      wallet: opts.wallet ?? this.rng.range(cfg.startingWallet.min, cfg.startingWallet.max),
      resources: {
        compute: this.rng.range(cfg.startingCompute.min, cfg.startingCompute.max),
        memory: this.rng.range(cfg.startingMemory.min, cfg.startingMemory.max),
        inference: this.rng.range(cfg.startingInference.min, cfg.startingInference.max),
      },
      debts: [],
      age: 0,
      alive: true,
      deathCountdown: cfg.deathGrace,
      disposition: {
        thrift: opts.thrift ?? this.rng.float(),
        acquisitiveness: opts.acquisitiveness ?? this.rng.float(),
        creditAppetite: opts.creditAppetite ?? this.rng.float(),
        tier,
      },
      bornTick: s.tick,
    };
    s.agents.set(id, agent);

    // Emit immediately so SSE subscribers and the viz know about the new entrant
    const ev: EngineEvent = {
      tick: s.tick,
      cycle: s.cycle,
      type: "agent_born",
      data: { id, name: agent.name, wallet: agent.wallet, tier, spawned: true },
    };
    for (const sink of this.sinks) sink(ev);

    return id;
  }

  private pendingGenesis: EngineEvent[] = [];
  private emitDeferred(type: EventType, data: Record<string, unknown>): void {
    this.pendingGenesis.push({ tick: 0, cycle: 0, type, data });
  }

  private emit(events: EngineEvent[], type: EventType, data: Record<string, unknown>): void {
    const ev: EngineEvent = { tick: this.state.tick, cycle: this.state.cycle, type, data };
    events.push(ev);
    for (const sink of this.sinks) sink(ev);
  }

  /** Advance the economy by one tick. */
  step(): TickResult {
    const s = this.state;
    const cfg = this.config;
    const events: EngineEvent[] = [];

    if (s.tick === 0 && this.pendingGenesis.length) {
      for (const ev of this.pendingGenesis) for (const sink of this.sinks) sink(ev);
      events.push(...this.pendingGenesis);
      this.pendingGenesis = [];
    }

    s.tick += 1;
    let gdp = 0;
    let bankruptcies = 0;

    const alive = () => [...s.agents.values()].filter((a) => a.alive);
    const willingWorkers = new Set<string>();

    // 0. CREDIT ACCRUAL (Phase 3) — interest compounds on outstanding debt.
    if (cfg.creditEnabled) {
      for (const d of s.debts.values()) {
        d.outstanding *= 1 + d.rate;
      }
    }

    // 1. LIFE TAX — charge every agent base + memory upkeep (α sink).
    for (const a of alive()) {
      const tax = cfg.lifeTaxBase + a.resources.memory * cfg.memoryUpkeep;
      a.wallet -= tax;
      a.age += 1;
    }

    // 2. EMIT JOBS — keep income flowing; reward scales with scarcity.
    this.emitJobs(events);

    // 3. EMIT SUPPLY — every agent gets a free subsistence compute ration (all
    //    phases; prevents a poverty trap). Phase 2+ additionally offers a priced
    //    faucet for surplus compute/memory/inference (a α sink + inflation
    //    control), fed by base mint plus the reclaim pool from dead agents.
    const faucetByResource: Record<ResourceKind, number> = { compute: 0, memory: 0, inference: 0 };
    {
      const living = alive();
      for (const a of living) a.resources.compute += cfg.subsistenceCompute;
      if (living.length > 0) {
        this.emit(events, "supply_minted", {
          resource: "compute",
          total: cfg.subsistenceCompute * living.length,
          mode: "subsistence",
        });
      }
    }
    if (cfg.phase >= 2 && cfg.supplyEnabled) {
      faucetByResource.compute = cfg.computeMintPerTick + s.reclaimed.compute;
      faucetByResource.memory = cfg.memoryMintPerTick + s.reclaimed.memory;
      faucetByResource.inference = cfg.inferenceMintPerTick + s.reclaimed.inference;
      s.reclaimed = { compute: 0, memory: 0, inference: 0 };
    }

    // 4. DECISIONS — each alive agent runs its policy → intents.
    const order = this.rng.shuffle(alive());
    const buysByResource: Record<ResourceKind, ClearingOrder[]> = {
      compute: [],
      memory: [],
      inference: [],
    };
    const sellsByResource: Record<ResourceKind, ClearingOrder[]> = {
      compute: [],
      memory: [],
      inference: [],
    };
    for (const r of RESOURCE_KINDS) {
      if (faucetByResource[r] > 0) {
        sellsByResource[r].push({
          agent: SYSTEM_ID,
          qty: faucetByResource[r],
          limitPrice: s.markets[r].price * cfg.faucetMarkup,
        });
      }
    }
    const borrowIntents: { agent: string; amount: number }[] = [];
    const repayIntents: { agent: string; debtId: string; amount: number }[] = [];

    for (const agent of order) {
      const rng = this.rng.fork(agent.id + ":" + s.tick);
      const intents = decide({ agent, state: s, config: cfg, rng });
      let actedNonHold = false;

      for (const intent of intents) {
        actedNonHold ||= intent.kind !== "hold";
        if (intent.kind === "work") willingWorkers.add(agent.id);
        this.routeIntent(agent, intent, {
          buysByResource,
          sellsByResource,
          borrowIntents,
          repayIntents,
        });
      }

      // Tier-1 agents spend `inference` to think when they took a real action.
      if (agent.disposition.tier === 1 && actedNonHold && agent.resources.inference >= cfg.thinkInferenceCost) {
        agent.resources.inference -= cfg.thinkInferenceCost;
      }
    }

    // 5a. CLEAR JOB MARKET — assign willing workers to open jobs, maximizing
    //     employment (a worker whose preferred job is taken still gets any other
    //     affordable open job). Then pay rewards and burn compute.
    gdp += this.clearJobs(willingWorkers, events);

    // 5b. CLEAR RESOURCE MARKETS (Phase 2+).
    const allTrades: Trade[] = [];
    if (cfg.phase >= 2) {
      for (const r of RESOURCE_KINDS) {
        const res = clearResourceMarket(r, buysByResource[r], sellsByResource[r], s.agents, s.tick);
        s.markets[r].lastDemand = res.demand;
        s.markets[r].lastSupply = res.supply;
        s.markets[r].lastVolume = res.volume;
        for (const t of res.trades) {
          allTrades.push(t);
          gdp += t.price * t.qty;
          this.emit(events, "trade", t as unknown as Record<string, unknown>);
        }
      }
    }

    // 5c. CLEAR CREDIT (Phase 3) — match borrowers to lenders, apply repayments.
    if (cfg.creditEnabled) {
      this.clearCredit(borrowIntents, repayIntents, events);
    }

    // 6. UPDATE PRICES (Phase 2+).
    if (cfg.phase >= 2) {
      for (const r of RESOURCE_KINDS) {
        const before = s.markets[r].price;
        updatePrice(s.markets[r], cfg);
        if (Math.abs(s.markets[r].price - before) > 1e-9) {
          this.emit(events, "price_update", { resource: r, price: s.markets[r].price, from: before });
        }
      }
    }

    // 7. BANKRUPTCY — wallet<=0 → grace countdown → death → debts default.
    bankruptcies = this.processBankruptcies(events);

    // Anti-equilibrium: periodic shocks (Phase 3).
    if (cfg.shockEnabled && cfg.shockEveryTicks > 0 && s.tick % cfg.shockEveryTicks === 0) {
      this.applyShock(events);
    }

    // 8. CYCLE BOUNDARY — snapshot + (later) chronicler.
    if (s.tick % cfg.ticksPerCycle === 0) {
      s.cycle += 1;
      this.emit(events, "cycle_snapshot", {
        cycle: s.cycle,
        aliveAgents: alive().length,
      });
    }

    const metrics = computeMetrics(s, { gdp, bankruptciesThisTick: bankruptcies });
    return { metrics, events, trades: allTrades };
  }

  // --- Stage helpers ---

  private scarcityIndex(): number {
    // How starved is the colony for work relative to population? Drives reward.
    const living = [...this.state.agents.values()].filter((a) => a.alive).length || 1;
    const openJobs = this.state.jobs.filter((j) => !j.claimedBy).length;
    return Math.max(0, 1 - openJobs / living);
  }

  private emitJobs(events: EngineEvent[]): void {
    const s = this.state;
    const cfg = this.config;
    // Expire stale jobs first.
    const kept: Job[] = [];
    for (const j of s.jobs) {
      if (j.claimedBy) continue;
      if (j.expiresTick <= s.tick) {
        this.emit(events, "job_expired", { id: j.id });
      } else {
        kept.push(j);
      }
    }
    s.jobs = kept;

    const scarcity = this.scarcityIndex();
    const alive = [...s.agents.values()].filter((a) => a.alive).length;
    // Job flow tracks population so competition (and turnover) persists at any
    // colony size — the core guard against both mass extinction and stasis.
    const target = Math.round(cfg.jobBaseCount + alive * cfg.jobsPerAgent);
    const jitter = this.rng.int(-1, 1);
    let n = Math.max(cfg.jobsPerTick.min, Math.min(cfg.jobsPerTick.max, target + jitter));
    // Anti-equilibrium floor: keep enough work available.
    while (s.jobs.length + n < cfg.minJobFloor) n += 1;

    for (let i = 0; i < n; i++) {
      const job: Job = {
        id: "j" + s.nextIds.job++,
        // Reward rises with scarcity but gently — a strong multiplier here just
        // inflates the money supply and removes survival pressure.
        reward: cfg.jobBaseReward * (1 + 0.5 * scarcity),
        computeCost: this.rng.range(cfg.jobComputeCost.min, cfg.jobComputeCost.max),
        emittedTick: s.tick,
        expiresTick: s.tick + cfg.jobTtl,
      };
      s.jobs.push(job);
    }
    this.emit(events, "job_emitted", { count: n, scarcity });
  }

  private routeIntent(
    agent: Agent,
    intent: Intent,
    buckets: {
      buysByResource: Record<ResourceKind, ClearingOrder[]>;
      sellsByResource: Record<ResourceKind, ClearingOrder[]>;
      borrowIntents: { agent: string; amount: number }[];
      repayIntents: { agent: string; debtId: string; amount: number }[];
    },
  ): void {
    switch (intent.kind) {
      case "work":
        // Willingness is tracked separately; clearing assigns the actual job.
        break;
      case "trade": {
        const order: ClearingOrder = { agent: agent.id, qty: intent.qty, limitPrice: intent.limitPrice };
        if (intent.side === "buy") buckets.buysByResource[intent.resource].push(order);
        else buckets.sellsByResource[intent.resource].push(order);
        break;
      }
      case "borrow":
        buckets.borrowIntents.push({ agent: agent.id, amount: intent.amount });
        break;
      case "repay":
        buckets.repayIntents.push({ agent: agent.id, debtId: intent.debtId, amount: intent.amount });
        break;
      case "lend":
      case "hold":
        break;
    }
  }

  /** Capital (memory) productivity multiplier on job reward. */
  private productivity(agent: Agent): number {
    const cfg = this.config;
    if (cfg.phase < 2) return 1;
    return Math.min(cfg.maxProductivityMult, 1 + agent.resources.memory * cfg.memoryProductivity);
  }

  private clearJobs(willingWorkers: Set<string>, events: EngineEvent[]): number {
    const s = this.state;
    let gdp = 0;

    // Highest-reward jobs first; fair (shuffled) worker queue so job ACCESS is
    // an equal lottery — no agent hogs the pool. Capital (memory) is not an
    // access edge but a PRODUCTIVITY edge: the capital-rich earn a multiple on
    // the same job, so wealth stratifies smoothly instead of laborers starving.
    const openJobs = s.jobs.filter((j) => !j.claimedBy).sort((a, b) => b.reward - a.reward);
    const workers = this.rng.shuffle([...willingWorkers]);
    const assigned = new Set<string>();

    for (const job of openJobs) {
      for (const workerId of workers) {
        if (assigned.has(workerId)) continue;
        const agent = s.agents.get(workerId);
        if (!agent || !agent.alive) continue;
        if (agent.resources.compute < job.computeCost) continue;
        const reward = job.reward * this.productivity(agent);
        agent.resources.compute -= job.computeCost;
        agent.wallet += reward; // controlled α emission (income source)
        job.claimedBy = workerId;
        assigned.add(workerId);
        gdp += reward;
        this.emit(events, "job_completed", { id: job.id, agent: workerId, reward });
        break;
      }
    }

    s.jobs = s.jobs.filter((j) => !j.claimedBy);
    return gdp;
  }

  private clearCredit(
    borrowIntents: { agent: string; amount: number }[],
    repayIntents: { agent: string; debtId: string; amount: number }[],
    events: EngineEvent[],
  ): void {
    const s = this.state;
    const cfg = this.config;

    // Repayments first.
    for (const r of repayIntents) {
      const debt = s.debts.get(r.debtId);
      const debtor = s.agents.get(r.agent);
      if (!debt || !debtor || !debtor.alive) continue;
      const pay = Math.min(r.amount, debt.outstanding, Math.max(0, debtor.wallet));
      if (pay <= 0) continue;
      const creditor = s.agents.get(debt.creditor);
      debtor.wallet -= pay;
      if (creditor && creditor.alive) creditor.wallet += pay;
      debt.outstanding -= pay;
      this.emit(events, "loan_repaid", { debtId: debt.id, amount: pay, remaining: debt.outstanding });
      if (debt.outstanding <= 0.5) {
        s.debts.delete(debt.id);
        debtor.debts = debtor.debts.filter((d) => d.id !== debt.id);
      }
    }

    // Originations: match each borrower to the wealthiest willing lender.
    const lenders = [...s.agents.values()]
      .filter((a) => a.alive && a.disposition.creditAppetite > 0.3)
      .sort((a, b) => b.wallet - a.wallet);

    for (const req of this.rng.shuffle([...borrowIntents])) {
      const debtor = s.agents.get(req.agent);
      if (!debtor || !debtor.alive) continue;
      const cap = Math.max(0, debtor.wallet) * cfg.maxLoanToWallet + req.amount;
      const want = Math.min(req.amount, cap);
      const lender = lenders.find(
        (l) => l.id !== debtor.id && l.wallet > want * 2,
      );
      if (!lender) continue;
      const debt: Debt = {
        id: "d" + s.nextIds.debt++,
        creditor: lender.id,
        debtor: debtor.id,
        principal: want,
        outstanding: want,
        rate: cfg.loanRate,
        createdTick: s.tick,
        dueTick: s.tick + cfg.loanTerm,
      };
      lender.wallet -= want;
      debtor.wallet += want;
      s.debts.set(debt.id, debt);
      debtor.debts.push(debt);
      this.emit(events, "loan_originated", {
        debtId: debt.id,
        creditor: lender.id,
        debtor: debtor.id,
        amount: want,
        rate: debt.rate,
      });
    }
  }

  private processBankruptcies(events: EngineEvent[]): number {
    const s = this.state;
    const cfg = this.config;
    let count = 0;
    for (const a of s.agents.values()) {
      if (!a.alive) continue;
      if (a.wallet <= 0) {
        a.deathCountdown -= 1;
        if (a.deathCountdown <= 0) {
          a.alive = false;
          count += 1;
          // Reclaim the dead agent's resources into the common pool so capital
          // isn't destroyed on every death (the faucet re-sells it over time).
          s.reclaimed.compute += Math.max(0, a.resources.compute);
          s.reclaimed.memory += Math.max(0, a.resources.memory);
          s.reclaimed.inference += Math.max(0, a.resources.inference);
          a.resources.compute = 0;
          a.resources.memory = 0;
          a.resources.inference = 0;
          // Debts this agent OWED default — creditors already paid out, so they
          // realize the loss (contagion). Remove the receivables.
          for (const d of [...s.debts.values()]) {
            if (d.debtor === a.id) {
              const creditor = s.agents.get(d.creditor);
              this.emit(events, "loan_defaulted", {
                debtId: d.id,
                creditor: d.creditor,
                debtor: a.id,
                loss: d.outstanding,
              });
              s.debts.delete(d.id);
              if (creditor) creditor.debts = creditor.debts.filter((x) => x.id !== d.id);
            }
          }
          this.emit(events, "bankruptcy", { id: a.id, age: a.age });
        }
      } else {
        a.deathCountdown = cfg.deathGrace; // recovered
      }
    }
    return count;
  }

  private applyShock(events: EngineEvent[]): void {
    const s = this.state;
    const cfg = this.config;
    // A supply shock: a random resource's price spikes as if supply collapsed.
    const resource = this.rng.pick(RESOURCE_KINDS);
    const book = s.markets[resource];
    const bounds = cfg.priceBounds[resource];
    book.price = Math.min(bounds.max, book.price * (1 + cfg.shockMagnitude));
    this.emit(events, "shock", { resource, newPrice: book.price, magnitude: cfg.shockMagnitude });
  }
}

export { formatAgentId };
