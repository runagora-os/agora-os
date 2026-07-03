import type { Intent } from "../engine/intents.js";
import { tier0Policy, type PolicyContext } from "./policy.js";

/**
 * Tier-1 "notable" agents. They occasionally spend `inference` to make a
 * sharper strategic move on top of the baseline heuristic. For now the strategy
 * is a deterministic proxy so the sim runs fully offline; this is the seam
 * where a cheap-model LLM call plugs in later (whether to corner a market, form
 * a cartel, take a leveraged position). Spending inference is what makes
 * "thinking" an economic act.
 */
export function tier1Policy(ctx: PolicyContext): Intent[] {
  const { agent, state, config } = ctx;
  const base = tier0Policy(ctx);

  const canThink = agent.resources.inference >= config.thinkInferenceCost;
  if (!canThink) return base;

  // Strategic overlay: if this agent already dominates a resource's supply and
  // is flush, aggressively accumulate more to tighten the corner (monopoly
  // behavior emerges from optimizing survival + edge, not from a script).
  const cost = config.lifeTaxBase + agent.resources.memory * config.memoryUpkeep;
  if (agent.wallet > cost * 12) {
    const book = state.markets.inference;
    const qty = Math.max(1, Math.floor((agent.wallet - cost * 6) / Math.max(book.price, 1) * 0.4));
    if (qty >= 1) {
      // Replace any baseline trade with the strategic accumulation.
      const filtered: Intent[] = base.filter((i) => i.kind !== "trade");
      filtered.push({
        kind: "trade",
        side: "buy",
        resource: "inference",
        qty,
        limitPrice: book.price * 1.15,
      });
      return markThought(filtered);
    }
  }

  return markThought(base);
}

/**
 * Tag that this decision consumed inference. The engine reads the presence of a
 * "think" marker to burn the inference resource. We encode it as a no-op hold
 * only when nothing else was chosen; otherwise the engine burns on any Tier-1
 * action. Kept simple here — actual burn happens in the engine decisions stage.
 */
function markThought(intents: Intent[]): Intent[] {
  return intents;
}
