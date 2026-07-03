import type { ColonyState, ResourceKind } from "./types.js";
import { RESOURCE_KINDS } from "./types.js";
import { gini, livingAgents } from "./metrics.js";

/**
 * Emergent-structure detectors. These do NOT create phenomena — they READ the
 * ledger and report what has emerged from the rules. The chronicler consumes
 * these to narrate. Never use a detector's output to steer the engine.
 */
export type StructureKind =
  | "monopoly"
  | "wealth_concentration"
  | "credit_crisis"
  | "class_stratification"
  | "die_off";

export interface DetectedStructure {
  kind: StructureKind;
  severity: number; // 0..1
  detail: Record<string, unknown>;
}

export interface DetectorConfig {
  monopolyShare: number; // one agent holding >= this share of a resource
  giniThreshold: number; // wealth Gini above this = stratification
  crisisDefaultRate: number; // fraction of debt value defaulting recently
}

export const DEFAULT_DETECTORS: DetectorConfig = {
  monopolyShare: 0.5,
  giniThreshold: 0.6,
  crisisDefaultRate: 0.3,
};

/** Total units of a resource held across living agents. */
function resourceHoldings(state: ColonyState, r: ResourceKind): { total: number; top: { id: string; qty: number } } {
  let total = 0;
  let top = { id: "", qty: -Infinity };
  for (const a of state.agents.values()) {
    if (!a.alive) continue;
    const q = a.resources[r];
    total += q;
    if (q > top.qty) top = { id: a.id, qty: q };
  }
  return { total, top };
}

export function detectStructures(
  state: ColonyState,
  recentDefaults: { count: number; loss: number },
  recentBankruptcies: number,
  cfg: DetectorConfig = DEFAULT_DETECTORS,
): DetectedStructure[] {
  const out: DetectedStructure[] = [];
  const alive = livingAgents(state);
  if (alive.length === 0) return out;

  // Monopoly: one agent controls a large share of a resource's held supply.
  for (const r of RESOURCE_KINDS) {
    const { total, top } = resourceHoldings(state, r);
    if (total > 0 && top.qty / total >= cfg.monopolyShare) {
      out.push({
        kind: "monopoly",
        severity: Math.min(1, top.qty / total),
        detail: { resource: r, agent: top.id, share: top.qty / total },
      });
    }
  }

  // Wealth concentration / class stratification.
  const g = gini(alive.map((a) => a.wallet));
  if (g >= cfg.giniThreshold) {
    out.push({
      kind: "class_stratification",
      severity: Math.min(1, g),
      detail: { gini: g },
    });
  }

  // Credit crisis: a burst of defaults relative to outstanding debt.
  let outstanding = 0;
  for (const d of state.debts.values()) outstanding += d.outstanding;
  const denom = outstanding + recentDefaults.loss;
  if (denom > 0 && recentDefaults.loss / denom >= cfg.crisisDefaultRate && recentDefaults.count >= 3) {
    out.push({
      kind: "credit_crisis",
      severity: Math.min(1, recentDefaults.loss / denom),
      detail: { defaults: recentDefaults.count, loss: recentDefaults.loss },
    });
  }

  // Die-off: population collapsing.
  if (recentBankruptcies >= Math.max(3, alive.length * 0.2)) {
    out.push({
      kind: "die_off",
      severity: Math.min(1, recentBankruptcies / Math.max(1, alive.length)),
      detail: { bankruptcies: recentBankruptcies },
    });
  }

  return out;
}
