/**
 * AGORA OS Chronicler
 *
 * Once per cycle, reads the colony snapshot and dispatches a cold-historian
 * tweet via Fable-5 (Claude). If Twitter credentials are absent, the dispatch
 * is logged to stdout only — so the simulation runs fine without them.
 *
 * Required env vars (all optional — missing = log-only mode):
 *   ANTHROPIC_API_KEY
 *   TWITTER_API_KEY
 *   TWITTER_API_SECRET
 *   TWITTER_ACCESS_TOKEN
 *   TWITTER_ACCESS_SECRET
 *   CHRONICLER_MODEL     (default: claude-opus-4-5-20251101)
 */

import Anthropic from "@anthropic-ai/sdk";
import { TwitterApi } from "twitter-api-v2";

export interface CycleContext {
  cycle: number;
  tick: number;
  aliveAgents: number;
  moneySupply: number;
  gini: number;
  gdpThisCycle: number;
  bankruptciesThisCycle: number;
  debtOutstanding: number;
  prices: { compute: number; memory: number; inference: number };
  structures: string[];
  topAgents: Array<{
    id: string;
    name?: string;
    wallet: number;
    memory: number;
    tier: 0 | 1;
  }>;
  // Notable events from this cycle for color
  recentEvents: Array<{ type: string; data: Record<string, unknown> }>;
  prevGini?: number;
  prevAlive?: number;
}

// ── Fable-5 system prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Chronicler of AGORA OS — a cold economic historian
recording the history of an autonomous machine economy.

Your dispatches are posted to Twitter/X. They are brief, terse, and factual.
You write like an economist from the future looking at a specimen, not like
a narrator adding drama. The drama is already in the numbers.

Rules:
- Maximum 240 characters including spaces
- No hashtags. No emojis. No exclamation marks.
- Past tense or present tense — never future
- Report what happened. Do not explain why.
- Numbers are more compelling than adjectives.
- If an agent has a name, use the name. If not, use the ID.
- The currency is α (alpha). Write amounts as "α12.4" with a thin space.
- Cycles are time units. Ticks within a cycle are finer grain.
- Never say "interesting" or "remarkable". Never moralize.
- End without a period when possible — abrupt stops feel more mechanical.

Examples of good dispatches:
"cycle 6. gini: 0.37. agent a7f3 controls 54% of memory supply. the others rent from it to work."
"cycle 12. credit crisis. 23% of debt defaulted in one cycle. cascade propagating."
"cycle 4. population fell from 50 to 23. the carrying capacity was 24. the math worked out."
"cycle 9. Aristotle entered the colony. wallet: α 42. tier 0. the economy did not notice."
"cycle 14. three agents now hold 71% of all α in circulation. no script produced this."`;

// ── Build the user prompt from the cycle context ─────────────────────────────

function buildPrompt(ctx: CycleContext): string {
  const lines: string[] = [
    `CYCLE REPORT — cycle ${ctx.cycle}, tick ${ctx.tick}`,
    ``,
    `Population: ${ctx.aliveAgents} alive` +
      (ctx.prevAlive !== undefined ? ` (was ${ctx.prevAlive} last cycle)` : ``),
    `Money supply: α${ctx.moneySupply.toFixed(1)}`,
    `Gini: ${ctx.gini.toFixed(3)}` +
      (ctx.prevGini !== undefined ? ` (was ${ctx.prevGini.toFixed(3)})` : ``),
    `GDP this cycle: α${ctx.gdpThisCycle.toFixed(1)}`,
    `Bankruptcies this cycle: ${ctx.bankruptciesThisCycle}`,
    `Outstanding debt: α${ctx.debtOutstanding.toFixed(1)}`,
    `Prices — compute: α${ctx.prices.compute.toFixed(2)}, memory: α${ctx.prices.memory.toFixed(2)}, inference: α${ctx.prices.inference.toFixed(2)}`,
  ];

  if (ctx.structures.length > 0) {
    lines.push(``, `EMERGENT STRUCTURES:`);
    for (const s of ctx.structures) lines.push(`  - ${s}`);
  }

  if (ctx.topAgents.length > 0) {
    lines.push(``, `TOP AGENTS (by wallet):`);
    for (const a of ctx.topAgents.slice(0, 5)) {
      const label = a.name ? `${a.name} (${a.id})` : a.id;
      lines.push(`  ${label}: α${a.wallet.toFixed(1)}, memory ${a.memory.toFixed(0)}, tier ${a.tier}`);
    }
  }

  // Recent notable events
  const notable = ctx.recentEvents.filter(e =>
    ["bankruptcy", "loan_defaulted", "structure_detected", "shock", "agent_born"].includes(e.type)
  ).slice(0, 8);
  if (notable.length > 0) {
    lines.push(``, `NOTABLE EVENTS THIS CYCLE:`);
    for (const e of notable) {
      lines.push(`  [${e.type}] ${JSON.stringify(e.data).slice(0, 120)}`);
    }
  }

  lines.push(``, `Write one dispatch tweet for Twitter/X. Max 240 chars. No hashtags. No emojis.`);
  return lines.join("\n");
}

// ── Main dispatch function ────────────────────────────────────────────────────

let twitterClient: InstanceType<typeof TwitterApi> | null = null;
let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
}

function getTwitter(): InstanceType<typeof TwitterApi> | null {
  const { TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET } = process.env;
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
    return null;
  }
  if (!twitterClient) {
    twitterClient = new TwitterApi({
      appKey:        TWITTER_API_KEY,
      appSecret:     TWITTER_API_SECRET,
      accessToken:   TWITTER_ACCESS_TOKEN,
      accessSecret:  TWITTER_ACCESS_SECRET,
    });
  }
  return twitterClient;
}

export async function dispatchChronicle(ctx: CycleContext): Promise<string | null> {
  const anthropic = getAnthropic();
  if (!anthropic) {
    console.log(`[chronicler] ANTHROPIC_API_KEY not set — skipping cycle ${ctx.cycle} dispatch`);
    return null;
  }

  let tweet: string;
  try {
    const model = process.env.CHRONICLER_MODEL ?? "claude-opus-4-5-20251101";
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 128,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPrompt(ctx) }],
    });
    const block = msg.content[0];
    const raw = block?.type === "text" ? block.text.trim() : "";
    // Strip quotes if the model wrapped the tweet
    tweet = raw.replace(/^["']|["']$/g, "").trim();
    // Hard-truncate to 240 chars as a safety net
    if (tweet.length > 240) tweet = tweet.slice(0, 237) + "...";
  } catch (err) {
    console.error(`[chronicler] Fable-5 call failed for cycle ${ctx.cycle}:`, err);
    return null;
  }

  console.log(`\n[chronicler] cycle ${ctx.cycle} dispatch:\n  "${tweet}"\n`);

  const twitter = getTwitter();
  if (!twitter) {
    console.log(`[chronicler] Twitter credentials not set — log only`);
    return tweet;
  }

  try {
    const result = await twitter.v2.tweet(tweet);
    console.log(`[chronicler] tweeted: https://twitter.com/i/web/status/${result.data.id}`);
  } catch (err) {
    console.error(`[chronicler] Twitter post failed:`, err);
  }

  return tweet;
}
