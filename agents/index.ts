import type { Intent } from "../engine/intents.js";
import { tier0Policy, type PolicyContext } from "./policy.js";
import { tier1Policy } from "./tier1.js";

/** Route an agent to its decision policy based on its brain tier. */
export function decide(ctx: PolicyContext): Intent[] {
  if (ctx.agent.disposition.tier === 1) return tier1Policy(ctx);
  return tier0Policy(ctx);
}

export { tier0Policy, tier1Policy };
export type { PolicyContext };
