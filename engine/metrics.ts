import type { Agent, ColonyState, ColonyMetrics, ResourceKind } from "./types.js";
import { RESOURCE_KINDS } from "./types.js";

/** Gini coefficient of wallet balances across living agents. 0 = equal, 1 = one owns all. */
export function gini(values: number[]): number {
  const xs = values.filter((v) => v >= 0).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return 0;
  const total = xs.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += (2 * (i + 1) - n - 1) * xs[i]!;
  }
  return cum / (n * total);
}

export function livingAgents(state: ColonyState): Agent[] {
  return [...state.agents.values()].filter((a) => a.alive);
}

export function moneySupply(state: ColonyState): number {
  let sum = 0;
  for (const a of state.agents.values()) if (a.alive) sum += a.wallet;
  return sum;
}

export function computeMetrics(
  state: ColonyState,
  opts: { gdp: number; bankruptciesThisTick: number },
): ColonyMetrics {
  const alive = livingAgents(state);
  const prices = {} as Record<ResourceKind, number>;
  for (const r of RESOURCE_KINDS) prices[r] = state.markets[r].price;

  let totalDebt = 0;
  for (const d of state.debts.values()) totalDebt += d.outstanding;

  return {
    tick: state.tick,
    cycle: state.cycle,
    aliveAgents: alive.length,
    gdp: opts.gdp,
    moneySupply: alive.reduce((s, a) => s + a.wallet, 0),
    bankruptciesThisTick: opts.bankruptciesThisTick,
    totalDebtOutstanding: totalDebt,
    prices,
    gini: gini(alive.map((a) => a.wallet)),
  };
}
