import type { AgentId, ResourceKind } from "./types.js";

/**
 * Intents are what an agent policy PRODUCES. The engine is the only thing that
 * mutates state — agents never touch wallets directly, they only express what
 * they want to do. The market/clearing stages then decide what actually
 * happens (a bid may not fill, a job may be taken by someone else, etc.).
 */

export interface WorkIntent {
  kind: "work";
  /** Preferred job (a hint). The labor-market clearing may assign another open
   *  job if the preferred one is taken, so willing workers rarely idle while
   *  jobs go unclaimed. */
  jobId: string;
  /** Max compute the agent is willing to spend on a job this tick. */
  maxCompute: number;
}

export interface TradeIntent {
  kind: "trade";
  side: "buy" | "sell";
  resource: ResourceKind;
  qty: number;
  limitPrice: number;
}

export interface BorrowIntent {
  kind: "borrow";
  amount: number;
}

export interface LendIntent {
  kind: "lend";
  to: AgentId;
  amount: number;
}

export interface RepayIntent {
  kind: "repay";
  debtId: string;
  amount: number;
}

export interface HoldIntent {
  kind: "hold";
}

export type Intent =
  | WorkIntent
  | TradeIntent
  | BorrowIntent
  | LendIntent
  | RepayIntent
  | HoldIntent;
