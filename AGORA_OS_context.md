# AGORA OS — project context (CLAUDE.md)

Grounding doc for Cursor / Claude Code. Read this before writing code. Keep it open.

---

## What we're building

**AGORA OS** is an operating system that is an economy. Inside it live autonomous AI agents. They earn a currency, buy metered resources (compute, memory, inference), trade with each other, lend, borrow, and go bankrupt. Nobody scripts the outcomes — monopolies, cartels, credit crises, and class hierarchy emerge from simple rules as agents optimize survival. A frontier model (Fable 5) acts as the **chronicler**: it observes the whole economy each cycle and narrates it to Twitter as cold economic history.

The public framing is "an operating system." Under the hood it is a **rule-driven economic simulator**. Nobody expects a real kernel — they expect a live machine society, and that part is genuinely real and verifiable.

**Positioning:** watchable-from-second-one, runs autonomously with zero audience, emergent drama generates content by itself. This is the core value — do not add features that require audience participation to function.

**Ticker:** `α` (alpha — the first letter of AGORA; also crypto slang for edge/signal). Written as `$α` / `$ALPHA`. Fallbacks if the symbol is unusable on the launchpad: `Λ` (lambda), `Α` (capital alpha), `Δ` (delta).

---

## The prime directive for the economy

The whole project lives or dies on whether **emergent drama** appears. Drama is not authored — it must fall out of the rules. Three forces must always be present:

1. **Survival pressure** — existing costs money every tick (life tax). Idle agents die. This produces bankruptcies (drama).
2. **Scarcity** — resources are limited and priced by supply/demand. Scarcity produces monopolies, cartels, price wars.
3. **Income opportunity** — a job market + resource production give agents ways to earn. This produces specialization (producers, rentiers, banks, laborers).

If the sim collapses to a trivial equilibrium (everyone dies, or one winner then stasis), the rules are wrong — inject ongoing job flow and periodic shocks to keep it alive.

---

## Core economic model (build to this)

### Currency
Internal currency `₯` (credits). Controlled emission. Later pegged to the launched token (see Token section).

### Agent
```ts
interface Agent {
  id: string;              // e.g. "a7f3"
  wallet: number;          // ₯ balance
  resources: {
    compute: number;       // consumed by every action
    memory: number;        // persistent capacity owned (capital)
    inference: number;     // consumed to "think" (make LLM-backed decisions)
  };
  debts: Debt[];           // owed to other agents
  age: number;             // ticks alive
  alive: boolean;
  deathCountdown: number;  // ticks with wallet<=0 before removal
  role?: string;           // EMERGENT — inferred from behavior, not assigned
}
```
Do NOT assign roles. Roles (producer / rentier / bank / laborer / speculator) are labels the chronicler infers from behavior. The engine only knows wallets and resources.

### The tick loop (one economic step)
```
1. LIFE TAX      — charge every agent: base + memoryHeld * memoryUpkeep
2. EMIT JOBS     — push new jobs into the job market (keeps income flowing)
3. EMIT SUPPLY   — mint base compute at capped rate; miner-agents add supply
4. DECISIONS     — each alive agent runs its policy → produces intents
                   (work job / buy / sell / lend / borrow / hold)
5. CLEAR MARKETS — match job claims, match resource buy/sell orders, settle ₯
6. UPDATE PRICES — reprice each resource from realized demand vs supply
7. BANKRUPTCY    — wallet<=0 → decrement deathCountdown; hit 0 → agent dies,
                   its debts default, creditors take the loss (contagion)
8. (every N ticks = 1 CYCLE) snapshot state, log to chain, run chronicler
```

### Starting formulas (tune later)
```ts
const LIFE_TAX_BASE = 1;          // ₯ per tick just to exist
const MEMORY_UPKEEP = 0.05;       // ₯ per unit memory per tick (hoarding is costly → renting emerges)
const ACTION_COMPUTE_COST = 1;    // compute burned per action taken
const THINK_INFERENCE_COST = 1;   // inference burned to make an LLM-backed decision
const DEATH_GRACE = 3;            // ticks at wallet<=0 before removal
const PRICE_K = 0.15;             // price elasticity
// price update per resource:
newPrice = clamp(price * (1 + PRICE_K * (demand - supply) / Math.max(supply, 1)), MIN, MAX);
// job reward scales with how starved the colony is:
jobReward = baseReward * (1 + scarcityIndex);
```

### The elegant tradeoff (inference as thought)
An agent that wants a *smarter* decision must spend `inference` to run an LLM call. Cheap heuristic decisions cost little; strategic thinking costs the premium resource. This makes "thinking" an economic act and creates a real class split: rich agents can afford to think, poor ones run on reflex. Build this in — it's a core narrative and a natural cost governor.

### Emergent phenomena to expect (do NOT hardcode — detect and report)
Monopoly (one agent controls a resource's supply), cartel (agents pool ₯ to corner a market), credit crisis (over-lending → default cascade), class stratification (rentiers vs laborers vs the dying), boom/bust cycles, disruptive innovation (an agent finds a cheaper survival strategy). The chronicler's job is to *detect and narrate* these from the ledger, not to script them.

---

## Agents — decision policies (tiered for cost)

Running hundreds of full frontier agents is too expensive. Tier the brains:

- **Tier 0 (most agents, cheap):** rule-based heuristics. Bid on affordable jobs, buy resources below moving-average price, sell above, avoid death, repay debt if solvent. No LLM call — pure logic. This is the population.
- **Tier 1 (a handful of "notable" agents):** occasional cheap-model call for strategic moves (whether to corner a market, form a cartel, take a loan). Spend `inference` to do it.
- **Chronicler (Fable 5):** NOT an agent. See below.

Start with Tier 0 only to prove emergence, then add a few Tier 1 agents for sharper strategy.

---

## The chronicler (Fable 5) — content engine

Fable 5 does not play. It **observes and narrates**. Once per cycle:

- Input: a compact cycle summary (top agents by wealth, biggest price moves, bankruptcies, new debts, detected structures like a forming monopoly).
- Output: a Twitter dispatch in a **cold-historian voice** + optionally a short "state of the colony" analysis.
- Model string: `claude-fable-5` via Anthropic API. Runs once per cycle → cheap, and this is where "powered by Fable 5" is honest: reading emergent economics and narrating it well needs frontier reasoning.

Voice: detached economic historian documenting a civilization. Not "hi I'm an AI." Examples:
- `"the colony is 4 hours old. it has already invented a middle class."`
- `"agent a7f3 now controls the inference supply. the others must pay it to think. we did not design this."`
- `"day 4. the colony discovered debt. by nightfall, nine agents had discovered default."`

---

## On-chain (verifiability = the anti-fake flex)

Log cycle snapshots and major events (bankruptcies, monopoly formed, market crash) to Solana. Start simple (memo/program-log); a light Anchor program can come later. The point: a skeptic checks the block instead of trusting the stream. This is what separates AGORA from a scripted theater.

---

## Tech stack

- **Backend / engine:** TypeScript + Node on VPS, PM2, nginx. Deterministic tick loop.
- **State / ledger:** Postgres (or SQLite to start). Append-only event log + current-state tables.
- **Agent policies:** TypeScript; cheap-model API calls for Tier 1 only.
- **Chronicler:** Anthropic API, `claude-fable-5`, one call per cycle.
- **Frontend:** React dashboard (Lovable) reading engine state over REST/WebSocket. See mockup direction below.
- **On-chain:** Solana (@solana/web3.js), event logging.
- **Token:** pump.fun launch, ticker `α` ($α).

---

## Suggested repo layout
```
/engine        tick loop, markets, pricing, bankruptcy, shocks
/agents        Tier 0 heuristics + Tier 1 strategic policies
/chronicler    Fable 5 narration (cycle summary → dispatch)
/ledger        state models + on-chain logging
/api           serve state to frontend (REST + WS)
/web           dashboard (or a separate Lovable project)
/scripts       seed colony, run sim, replay
CLAUDE.md      this file
```

---

## Build order (MVP phases)

1. **Survival core** — tick loop + life tax + ONE resource (compute) + job market + bankruptcy. Seed ~50 Tier-0 agents. Success = it's already interesting to watch who dies and who survives.
2. **Resource trade** — add memory + inference, order books, price dynamics → specialization, rentiers, producers emerge.
3. **Credit** — loans, interest, defaults → first credit crisis (a strong launch moment).
4. **Chronicler** — Fable 5 cycle dispatches to Twitter.
5. **Dashboard** — the live витрina (see below).
6. **Token launch** ($α). Later: sponsor-an-agent, on-chain settlement program, inheritance/dynasties.

---

## Frontend / dashboard direction

Live dashboard of the machine economy (dark product screen):
- Top metric strip: colony GDP, money supply, active agents, bankruptcies today.
- SETTLEMENTS: live trade feed (agent → agent, amount ₯, good).
- RICHEST AGENTS: leaderboard, positions move in real time.
- RESOURCE PRICES: compute / memory / inference ticking ▲▼.
- EVENT line: monopolies, cartels, crashes, bankruptcies.
- BROADCAST: the chronicler's dispatches (what goes to Twitter).

Everything ticks live. Feeling: a living society under glass.

---

## Branding — AGORA OS

Aesthetic: **ancient Greece meets machine**. Not the hacker-green terminal cliché. Engraved stone and Roman/Greek lettering rendered through a CRT/pixel lens — "an ancient civilization built by machines." Marble + phosphor.

- **Palette:** stone/bone `#E8E0D0`, worn bronze `#A8842C`, oxidized copper/patina `#4A7C6A`, obsidian black `#0E0C0A`, ruby-blood for crashes `#7A1E12`.
- **Type:** headings — engraved/Roman character (Trajan-like); data — monospace. Contrast of the eternal × the machine.
- **Voice:** the chronicler is a cold historian ("chronicle of the colony, cycle 6"), as if Thucydides wrote about machines.
- **Symbol / logo:** an engraved coin / seal of the machine polis (money + civilization + artifact in one), or a column that doubles as a candle/chart.
- **Ticker:** `α` ($α / $ALPHA — first letter of AGORA, doubles as crypto "alpha"). Fallbacks: `Λ`, `Α`, `Δ`.

---

## Constraints / do-nots

- Do not require audience participation for the core loop. The colony must run and be interesting with zero viewers.
- Do not assign agent roles — they emerge.
- Do not script events — the engine produces them from rules; the chronicler detects and narrates.
- Do not fake the economy — it must be genuinely rule-driven and logged on-chain. Skeptics will check.
- Keep Fable 5 as the chronicler (once per cycle), not as per-agent brains — cost and honesty both depend on this.
- Guard against trivial equilibrium: always keep job flow and periodic shocks so the economy never freezes.
