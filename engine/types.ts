/**
 * Core domain types for the AGORA economy.
 *
 * The engine only ever knows about wallets, resources, jobs, orders and debts.
 * It deliberately does NOT know about "roles" (producer / rentier / bank /
 * laborer). Those are labels the chronicler infers from behavior — never
 * assigned by the engine.
 */

export type AgentId = string;

/** The three metered resources of the machine society. */
export type ResourceKind = "compute" | "memory" | "inference";

export const RESOURCE_KINDS: readonly ResourceKind[] = [
  "compute",
  "memory",
  "inference",
] as const;

export interface ResourceBundle {
  /** Consumed by every action. */
  compute: number;
  /** Persistent capacity owned — this is capital, and it costs upkeep. */
  memory: number;
  /** Consumed to "think" (make an LLM-backed / strategic decision). */
  inference: number;
}

export interface Debt {
  id: string;
  creditor: AgentId;
  debtor: AgentId;
  principal: number; // original α lent
  outstanding: number; // remaining α owed (principal + accrued interest - repaid)
  rate: number; // per-tick interest rate
  createdTick: number;
  dueTick: number; // soft due date; past this, pressure to repay rises
}

/**
 * Behavioral disposition of an agent. This is NOT a role — it is a small set of
 * innate parameters that bias the heuristic policy. Two agents with the same
 * disposition can end up as a rentier and a laborer purely from luck + market
 * conditions. Roles still emerge; this only seeds variety.
 */
export interface Disposition {
  /** 0 = spend freely / risk-loving, 1 = hoard cash / risk-averse. */
  thrift: number;
  /** 0 = never buys capital, 1 = aggressively accumulates memory. */
  acquisitiveness: number;
  /** 0 = never lends/borrows, 1 = eager to use credit. */
  creditAppetite: number;
  /** Tier of "brain": 0 = pure heuristic, 1 = occasional LLM strategy. */
  tier: 0 | 1;
}

export interface Agent {
  id: AgentId;
  wallet: number; // α balance
  resources: ResourceBundle;
  debts: Debt[]; // debts this agent OWES (as debtor)
  age: number; // ticks alive
  alive: boolean;
  deathCountdown: number; // ticks with wallet<=0 before removal
  disposition: Disposition;
  bornTick: number;
  /** Human-readable display name set at spawn time (e.g. "Aristotle"). */
  name?: string;
  /**
   * EMERGENT — a label the chronicler may attach after observing behavior.
   * The engine never reads this to make decisions.
   */
  role?: string;
}

export interface Job {
  id: string;
  reward: number; // α paid on completion
  computeCost: number; // compute burned to perform it
  emittedTick: number;
  expiresTick: number; // unclaimed jobs expire
  claimedBy?: AgentId;
}

export type OrderSide = "buy" | "sell";

export interface Order {
  id: string;
  agent: AgentId;
  side: OrderSide;
  resource: ResourceKind;
  qty: number; // units
  limitPrice: number; // α per unit (max for buy, min for sell)
  tick: number;
}

/** Realized market state for one resource in the current tick. */
export interface MarketBook {
  resource: ResourceKind;
  price: number; // current spot price (α per unit)
  priceHistory: number[]; // rolling recent prices (for moving averages)
  lastDemand: number; // units demanded last clearing
  lastSupply: number; // units supplied last clearing
  lastVolume: number; // units actually traded last clearing
}

/** Types of events appended to the immutable event log. */
export type EventType =
  | "agent_born"
  | "life_tax"
  | "job_emitted"
  | "job_completed"
  | "job_expired"
  | "supply_minted"
  | "trade"
  | "loan_originated"
  | "loan_repaid"
  | "loan_defaulted"
  | "price_update"
  | "bankruptcy"
  | "shock"
  | "cycle_snapshot"
  | "structure_detected";

export interface EngineEvent {
  tick: number;
  cycle: number;
  type: EventType;
  /** Structured payload — shape depends on type. */
  data: Record<string, unknown>;
}

/** A single settled trade (agent -> agent, a good, an amount). */
export interface Trade {
  buyer: AgentId;
  seller: AgentId;
  resource: ResourceKind;
  qty: number;
  price: number; // α per unit
  tick: number;
}

/** Full colony state at a point in time. */
export interface ColonyState {
  tick: number;
  cycle: number;
  agents: Map<AgentId, Agent>;
  markets: Record<ResourceKind, MarketBook>;
  jobs: Job[]; // open (unclaimed, unexpired) jobs
  debts: Map<string, Debt>; // all active debts by id
  /** Resources reclaimed from dead agents, re-sold onto the market over time so
   *  capital isn't destroyed on every bankruptcy (which would shrink the economy). */
  reclaimed: ResourceBundle;
  nextIds: {
    agent: number;
    job: number;
    order: number;
    debt: number;
    event: number;
  };
}

/** Aggregate metrics computed each tick for the dashboard / chronicler. */
export interface ColonyMetrics {
  tick: number;
  cycle: number;
  aliveAgents: number;
  gdp: number; // α value transacted this tick (jobs + trades)
  moneySupply: number; // total α across all wallets
  bankruptciesThisTick: number;
  totalDebtOutstanding: number;
  prices: Record<ResourceKind, number>;
  gini: number; // wealth inequality [0,1]
}
