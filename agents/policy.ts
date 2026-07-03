import type { SimConfig } from "../engine/config.js";
import type { Rng } from "../engine/rng.js";
import type { Agent, ColonyState, Job, MarketBook } from "../engine/types.js";
import type { Intent } from "../engine/intents.js";

/**
 * Context handed to a policy. Read-only — a policy expresses intents, it never
 * mutates state. All randomness comes from the provided per-agent Rng so runs
 * stay deterministic.
 */
export interface PolicyContext {
  agent: Agent;
  state: ColonyState;
  config: SimConfig;
  rng: Rng;
}

function movingAverage(book: MarketBook): number {
  const h = book.priceHistory;
  if (h.length === 0) return book.price;
  return h.reduce((s, v) => s + v, 0) / h.length;
}

/** Projected α cost to merely survive the next tick. */
function survivalCost(agent: Agent, config: SimConfig): number {
  return config.lifeTaxBase + agent.resources.memory * config.memoryUpkeep;
}

/**
 * Tier-0 heuristic policy — the population. Pure logic, no LLM call.
 * Priorities, in order:
 *   1. If in debt and solvent, repay (avoid default pressure).
 *   2. Earn: claim the most profitable affordable job.
 *   3. Trade: buy capital below moving-average when flush; sell when squeezed.
 *   4. Borrow only when near death and credit is enabled.
 */
export function tier0Policy(ctx: PolicyContext): Intent[] {
  const { agent, state, config, rng } = ctx;
  const intents: Intent[] = [];
  const cost = survivalCost(agent, config);
  const canAct = agent.resources.compute >= config.actionComputeCost;

  // 1. Repay debt if comfortably solvent (keep a survival buffer).
  if (config.creditEnabled && agent.debts.length > 0) {
    const buffer = cost * 4;
    if (agent.wallet > buffer) {
      const debt = agent.debts.reduce((a, b) => (a.outstanding > b.outstanding ? a : b));
      const pay = Math.min(debt.outstanding, agent.wallet - buffer);
      if (pay > 0.5) intents.push({ kind: "repay", debtId: debt.id, amount: pay });
    }
  }

  // 2. Work: pick the affordable job with the best reward-per-compute.
  if (canAct) {
    const affordable = state.jobs
      .filter((j) => !j.claimedBy && j.computeCost <= agent.resources.compute)
      .sort((a, b) => b.reward / b.computeCost - a.reward / a.computeCost);
    const target = pickJob(affordable, agent, rng);
    if (target) {
      intents.push({ kind: "work", jobId: target.id, maxCompute: agent.resources.compute });
    }
  }

  // 3. Trade resources (Phase 2+): buy compute fuel, manage memory capital.
  if (config.phase >= 2) {
    for (const t of decideTrades(ctx, movingAverage)) intents.push(t);
  }

  // 4. Borrow to avoid imminent death (Phase 3+).
  if (
    config.creditEnabled &&
    agent.wallet < cost * 2 &&
    agent.debts.length === 0 &&
    rng.chance(0.5 + agent.disposition.creditAppetite * 0.5)
  ) {
    const amount = Math.max(cost * 5, 5) * (0.5 + agent.disposition.creditAppetite);
    intents.push({ kind: "borrow", amount });
  }

  if (intents.length === 0) intents.push({ kind: "hold" });
  return intents;
}

/** Slight randomness in job choice so agents don't stampede one job deterministically. */
function pickJob(sorted: Job[], _agent: Agent, rng: Rng): Job | undefined {
  if (sorted.length === 0) return undefined;
  // Mostly greedy, occasionally pick the runner-up to spread claims.
  if (sorted.length > 1 && rng.chance(0.25)) return sorted[1];
  return sorted[0];
}

function decideTrades(
  ctx: PolicyContext,
  ma: (b: MarketBook) => number,
): Intent[] {
  const { agent, state, config, rng } = ctx;
  const out: Intent[] = [];
  const cost = config.lifeTaxBase + agent.resources.memory * config.memoryUpkeep;
  const flush = agent.wallet > cost * 8;
  const squeezed = agent.wallet < cost * 3;

  // (a) FUEL: buy compute to keep working. Without compute an agent earns
  //     nothing, so this is the top trading priority whenever affordable.
  if (agent.resources.compute < config.computeTargetBuffer && agent.wallet > cost * 2) {
    const book = state.markets.compute;
    const price = ma(book) * 1.1; // willing to pay a bit over MA for essential fuel
    const need = config.computeTargetBuffer - agent.resources.compute;
    const budget = (agent.wallet - cost * 2) * 0.5;
    const qty = Math.max(1, Math.floor(Math.min(need, budget / Math.max(price, 0.25))));
    if (qty >= 1) out.push({ kind: "trade", side: "buy", resource: "compute", qty, limitPrice: price });
  }

  // (b) DISTRESS: liquidate memory capital to raise α when squeezed.
  if (squeezed && agent.resources.memory > 1) {
    const book = state.markets.memory;
    const qty = Math.min(agent.resources.memory, 1 + Math.floor(agent.resources.memory * 0.4));
    out.push({ kind: "trade", side: "sell", resource: "memory", qty, limitPrice: ma(book) * 0.85 });
    return out; // don't also buy capital while distressed
  }

  // (c) INVEST: buy memory (productive capital) when flush and acquisitive.
  //     memory grants extra job slots, so this compounds income — the engine
  //     of wealth concentration and the producer/rentier class.
  if (flush && rng.chance(0.3 + agent.disposition.acquisitiveness * 0.6)) {
    const book = state.markets.memory;
    const budget = agent.wallet - cost * 6;
    const price = ma(book) * 1.05;
    const qty = Math.max(1, Math.floor((budget / Math.max(price, 0.5)) * 0.3));
    if (qty >= 1) out.push({ kind: "trade", side: "buy", resource: "memory", qty, limitPrice: price });
  }

  return out;
}
