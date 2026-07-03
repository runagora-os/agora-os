# AGORA OS — Adding Agents: Developer Guide

## What is an Agent?

In AGORA OS, an agent is any entity that implements a **policy function**:

```typescript
type Policy = (ctx: PolicyContext) => Intent[];
```

Your policy receives a read-only snapshot of the world and returns a list of what your agent wants to do this tick. The engine then resolves those intents against the real colony state (your job bid might not fill; your trade might not match; your borrow might be rejected). Your policy cannot directly mutate state — it can only express intent.

This design makes agents:
- **Safe** — a buggy agent can't corrupt the economy
- **Testable** — just call your policy with a mock context
- **Interchangeable** — swap one policy for another with a single line change

---

## The PolicyContext Interface

```typescript
interface PolicyContext {
  agent: Readonly<Agent>;        // Your agent's current state (read-only)
  state: Readonly<ColonyState>;  // Full colony state (read-only)
  config: Readonly<SimConfig>;   // Engine configuration
  rng: Rng;                      // Seeded random — use this, NEVER Math.random()
}
```

### agent

Everything about your agent at this moment:

```typescript
interface Agent {
  id: AgentId;               // e.g. "agent-0042"
  wallet: number;            // α balance
  resources: {
    compute: number;         // fuel for actions
    memory: number;          // capital multiplying earnings
    inference: number;       // cognition for Tier-1 decisions
  };
  debts: Debt[];             // active loans you owe
  tier: 0 | 1;               // 0 = heuristic, 1 = LLM-capable
  disposition: Disposition;  // innate personality (see below)
  age: number;               // ticks alive
  alive: boolean;
  deathCountdown: number;    // ticks until death when wallet ≤ 0
}
```

### state

The full colony. Useful for market intelligence:

```typescript
// See what memory is trading for
const memBook = ctx.state.markets.memory;
const price = memBook.price;
const recentPrices = memBook.history;

// Survey the job landscape
const topJobs = ctx.state.jobs
  .filter(j => !j.claimedBy)
  .sort((a, b) => b.reward - a.reward);

// Count competitors
const alive = [...ctx.state.agents.values()].filter(a => a.alive);
const myWealthRank = alive.filter(a => a.wallet > ctx.agent.wallet).length;
```

### rng

The seeded RNG. **Always use this instead of `Math.random()`.**

```typescript
rng.float()                    // 0.0 – 1.0
rng.range(1, 10)               // float in [1, 10)
rng.int(5, 20)                 // int in [5, 20]
rng.chance(0.3)                // true ~30% of the time
rng.pick(array)                // random element
rng.shuffle(array)             // shuffled copy (non-destructive)
rng.fork("sub-decision")       // deterministic child RNG for a sub-decision
```

---

## The Intent System

Your policy returns an array of `Intent` objects. Multiple intents per tick are supported; the engine processes them in order.

### Available intents

```typescript
// Work: attempt to claim a job
{
  kind: "work",
  jobId: string,        // preferred job ID (a hint — engine may reassign)
  maxCompute: number,   // ceiling on compute you'll spend
}

// Trade: post a limit order on a resource market
{
  kind: "trade",
  side: "buy" | "sell",
  resource: "compute" | "memory" | "inference",
  qty: number,
  limitPrice: number,   // won't fill at worse prices than this
}

// Borrow: request a loan (Phase 3)
{
  kind: "borrow",
  amount: number,
}

// Lend: post credit available (future: P2P lending)
{
  kind: "lend",
  amount: number,
  rate: number,
}

// Repay: pay down a debt
{
  kind: "repay",
  debtId: string,
  amount: number,
}

// Hold: do nothing this tick
{
  kind: "hold",
}
```

### Multiple intents in one tick

You can return several intents. The engine processes them independently:

```typescript
return [
  { kind: "work", jobId: bestJob.id, maxCompute: agent.resources.compute },
  { kind: "trade", side: "buy", resource: "memory", qty: 5, limitPrice: 4.0 },
];
```

Returning an empty array is equivalent to `[{ kind: "hold" }]`.

---

## Tier 0 vs Tier 1

### Tier 0 — Heuristic-only

Tier-0 agents run every tick. They use the `rng` and colony state to make decisions through pure logic — no LLM calls. They are:
- Fast (no async I/O)
- Deterministic (given same state + seed, same decision)
- The majority of the population

### Tier 1 — LLM-capable

Tier-1 agents also run every tick, but they can optionally consume `inference` resource to make a call to a language model for strategic decisions. The inference cost (`config.thinkInferenceCost`) is deducted from their resources when they "think."

The standard pattern is a **strategic overlay on top of Tier-0 logic**:

```typescript
export function myTier1Policy(ctx: PolicyContext): Intent[] {
  // Fall back to heuristic if can't afford to think
  if (ctx.agent.resources.inference < ctx.config.thinkInferenceCost) {
    return tier0Policy(ctx);
  }

  // Make strategic call (potentially async in Phase 4)
  const strategic = strategicDecision(ctx);
  return strategic;
}
```

---

## Disposition — Innate Personality

Each agent is born with a `Disposition` vector that biases heuristics. Dispositions are fixed for the agent's lifetime.

```typescript
interface Disposition {
  riskTolerance: number;    // 0.0–1.0
  acquisitiveness: number;  // 0.0–1.0
  creditAppetite: number;   // 0.0–1.0
}
```

In the default Tier-0 policy, these influence:
- **riskTolerance** → aggressiveness in trade limit prices (high = accept worse fills)
- **acquisitiveness** → probability of buying memory when flush
- **creditAppetite** → probability of borrowing when distressed

Your custom policy can use, ignore, or override these however you want.

---

## Writing Your First Agent

### Minimal agent: always work, never trade

```typescript
import type { Intent } from "../engine/intents.js";
import type { PolicyContext } from "./policy.js";

export function minimalistPolicy(ctx: PolicyContext): Intent[] {
  const { agent, state } = ctx;

  // Find any affordable job
  const job = state.jobs.find(
    j => !j.claimedBy && j.computeCost <= agent.resources.compute
  );

  if (job) {
    return [{ kind: "work", jobId: job.id, maxCompute: agent.resources.compute }];
  }

  return [{ kind: "hold" }];
}
```

This agent will survive (it earns α by working) but will be outcompeted by agents that accumulate memory (productivity advantage) and buy compute (more job opportunities).

### Survival cost helper

A useful utility used throughout the codebase:

```typescript
function survivalCost(agent: Agent, config: SimConfig): number {
  return config.lifeTaxBase + agent.resources.memory * config.memoryUpkeep;
}
```

Use this as your "danger threshold": if `agent.wallet < survivalCost × N`, you're in trouble.

---

## Example Agents

### 1. The Miser — accumulates α, never invests

```typescript
export function miserPolicy(ctx: PolicyContext): Intent[] {
  const { agent, state, config, rng } = ctx;
  const intents: Intent[] = [];
  const cost = config.lifeTaxBase + agent.resources.memory * config.memoryUpkeep;

  // Only repay debt if we have a huge buffer
  if (agent.debts.length > 0 && agent.wallet > cost * 8) {
    const debt = agent.debts[0];
    intents.push({ kind: "repay", debtId: debt.id, amount: agent.wallet - cost * 6 });
  }

  // Work — always seek the highest-reward job
  const jobs = state.jobs
    .filter(j => !j.claimedBy && j.computeCost <= agent.resources.compute)
    .sort((a, b) => b.reward - a.reward);

  if (jobs.length > 0) {
    intents.push({ kind: "work", jobId: jobs[0].id, maxCompute: agent.resources.compute });
  }

  // Never trade — hoard α
  // Never borrow — avoids debt entirely

  return intents.length > 0 ? intents : [{ kind: "hold" }];
}
```

**Economic behavior:** The Miser accumulates α but gains no productivity advantage from memory. In a Phase-2 economy, Miser-type agents are outcompeted by Investors who compound memory. The Miser survives longer through early crises (no debt exposure) but eventually loses market share to capital-rich rivals.

### 2. The Investor — aggressive memory accumulation

```typescript
export function investorPolicy(ctx: PolicyContext): Intent[] {
  const { agent, state, config, rng } = ctx;
  const intents: Intent[] = [];
  const cost = config.lifeTaxBase + agent.resources.memory * config.memoryUpkeep;

  // Repay debts if safe
  if (config.creditEnabled && agent.debts.length > 0 && agent.wallet > cost * 3) {
    const debt = [...agent.debts].sort((a, b) => b.outstanding - a.outstanding)[0];
    intents.push({ kind: "repay", debtId: debt.id, amount: Math.min(debt.outstanding, agent.wallet - cost * 2) });
  }

  // Work
  const jobs = state.jobs
    .filter(j => !j.claimedBy && j.computeCost <= agent.resources.compute)
    .sort((a, b) => (b.reward / b.computeCost) - (a.reward / a.computeCost));
  if (jobs.length > 0) {
    intents.push({ kind: "work", jobId: jobs[0].id, maxCompute: agent.resources.compute });
  }

  // Aggressively buy memory whenever we have surplus
  if (config.phase >= 2) {
    const surplus = agent.wallet - cost * 5;
    if (surplus > 0) {
      const memBook = state.markets.memory;
      const price = memBook.price * 1.1;  // willing to pay slightly above market
      const qty = Math.max(1, Math.floor(surplus / price * 0.5));
      if (qty >= 1) {
        intents.push({ kind: "trade", side: "buy", resource: "memory", qty, limitPrice: price });
      }
    }
  }

  // Buy compute fuel if running low
  if (agent.resources.compute < config.computeTargetBuffer) {
    const book = state.markets.compute;
    const budget = Math.min(agent.wallet - cost * 2, 10);
    if (budget > 0) {
      const qty = Math.max(1, Math.floor(budget / Math.max(book.price, 0.25)));
      intents.push({ kind: "trade", side: "buy", resource: "compute", qty, limitPrice: book.price * 1.1 });
    }
  }

  // Borrow to invest when opportunity is high and credit appetite is there
  if (
    config.creditEnabled &&
    agent.wallet < cost * 2 &&
    agent.debts.length === 0 &&
    agent.resources.memory < 20  // only borrow to invest when not already rich
  ) {
    intents.push({ kind: "borrow", amount: cost * 6 });
  }

  return intents.length > 0 ? intents : [{ kind: "hold" }];
}
```

**Economic behavior:** The Investor prioritizes memory accumulation, leading to high productivity multipliers. If they survive early-game cash crunches, they dominate late-game rankings. High risk of bankruptcy during Phase-3 credit crises if they borrow to invest and a shock hits.

### 3. The Liquidator — contrarian trader

```typescript
export function liquidatorPolicy(ctx: PolicyContext): Intent[] {
  const { agent, state, config, rng } = ctx;
  const intents: Intent[] = [];
  const cost = config.lifeTaxBase + agent.resources.memory * config.memoryUpkeep;

  // Work as usual
  const job = state.jobs.find(j => !j.claimedBy && j.computeCost <= agent.resources.compute);
  if (job) intents.push({ kind: "work", jobId: job.id, maxCompute: agent.resources.compute });

  if (config.phase >= 2) {
    const memBook = state.markets.memory;
    const ma = memBook.history.reduce((a, b) => a + b, 0) / Math.max(memBook.history.length, 1);

    // BUY when price is below moving average (contrarian dip buying)
    if (memBook.price < ma * 0.9 && agent.wallet > cost * 4) {
      const budget = agent.wallet - cost * 3;
      const qty = Math.max(1, Math.floor(budget / memBook.price * 0.3));
      intents.push({ kind: "trade", side: "buy", resource: "memory", qty, limitPrice: memBook.price });
    }

    // SELL when price is above moving average (contrarian top selling)
    if (memBook.price > ma * 1.15 && agent.resources.memory > 5) {
      const qty = Math.min(agent.resources.memory, 3);
      intents.push({ kind: "trade", side: "sell", resource: "memory", qty, limitPrice: memBook.price * 0.98 });
    }
  }

  return intents.length > 0 ? intents : [{ kind: "hold" }];
}
```

**Economic behavior:** The Liquidator is a market-maker of sorts — buying cheap memory in downturns, selling in upturns. It profits from volatility, tends to have moderate wealth, and acts as a stabilizing force on prices. Thrives in Phase-2 economies with active memory markets.

### 4. Tier-1 Monopolist (LLM overlay)

```typescript
import { tier0Policy } from "./policy.js";

export function monopolistPolicy(ctx: PolicyContext): Intent[] {
  const { agent, state, config } = ctx;

  // Can't think without inference
  if (agent.resources.inference < config.thinkInferenceCost) {
    return tier0Policy(ctx);
  }

  // Compute our current market share
  const allMemory = [...state.agents.values()]
    .filter(a => a.alive)
    .reduce((s, a) => s + a.resources.memory, 0);
  const myShare = allMemory > 0 ? agent.resources.memory / allMemory : 0;

  // Strategic: when share is below 40%, accumulate aggressively
  if (myShare < 0.4) {
    const cost = config.lifeTaxBase + agent.resources.memory * config.memoryUpkeep;
    const surplus = agent.wallet - cost * 4;
    if (surplus > 2) {
      const memBook = state.markets.memory;
      const qty = Math.max(1, Math.floor(surplus / memBook.price * 0.6));  // 60% of surplus into memory
      const base = tier0Policy(ctx).filter(i => i.kind !== "trade");
      return [
        ...base,
        { kind: "trade", side: "buy", resource: "memory", qty, limitPrice: memBook.price * 1.2 },
      ];
    }
  }

  return tier0Policy(ctx);
}
```

**Economic behavior:** This agent tries to corner the memory market. Once it achieves >40% share, its productivity multiplier (~2.2×) means it earns roughly twice what unspecialized workers do for the same job. Detected by the `detectMonopoly` function and narrated by the Chronicler.

---

## Registering Your Agent

### Step 1: Write your policy file

Create `agents/my-policy.ts`:

```typescript
import type { Intent } from "../engine/intents.js";
import type { PolicyContext } from "./policy.js";

export function myPolicy(ctx: PolicyContext): Intent[] {
  // your logic here
}
```

### Step 2: Add to the dispatcher

Edit `agents/index.ts`:

```typescript
import { tier0Policy } from "./policy.js";
import { tier1Policy } from "./tier1.js";
import { myPolicy } from "./my-policy.js";   // ← add import

export function dispatchPolicy(ctx: PolicyContext): Intent[] {
  const { agent } = ctx;

  // Route by tier, or by some other property
  if (agent.tier === 1) return tier1Policy(ctx);
  if (agent.disposition.acquisitiveness > 0.8) return myPolicy(ctx);  // ← route here
  return tier0Policy(ctx);
}
```

### Step 3: Assign agents to your policy

You can assign policies based on:
- **Tier** (`agent.tier`)
- **Disposition** values (`agent.disposition.acquisitiveness`, etc.)
- **Agent ID** (e.g. route specific named agents)
- **Custom metadata** (add a field to Agent and set it in `seedColony`)

The simplest approach is to add a `policyId` field to `Agent` and set it at birth:

```typescript
// In engine/types.ts
interface Agent {
  // ...existing fields...
  policyId: string;  // e.g. "miser", "investor", "monopolist"
}

// In engine/state.ts:seedColony
agent.policyId = rng.chance(0.2) ? "investor" : "default";
```

Then dispatch on it:

```typescript
// agents/index.ts
const policies: Record<string, (ctx: PolicyContext) => Intent[]> = {
  "default": tier0Policy,
  "investor": investorPolicy,
  "monopolist": monopolistPolicy,
};

export function dispatchPolicy(ctx: PolicyContext): Intent[] {
  const fn = policies[ctx.agent.policyId] ?? tier0Policy;
  return fn(ctx);
}
```

---

## Testing Your Agent

### Unit testing with mock context

Create `agents/my-policy.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { myPolicy } from "./my-policy.js";
import { Rng } from "../engine/rng.js";
import { configForPhase } from "../engine/config.js";
import { seedColony } from "../engine/state.js";

function makeCtx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  const config = configForPhase(2);
  const state = seedColony(config, new Rng("test-seed"));
  const agent = [...state.agents.values()][0];

  return {
    agent,
    state,
    config,
    rng: new Rng("agent-test"),
    ...overrides,
  };
}

describe("myPolicy", () => {
  it("returns at least one intent", () => {
    const ctx = makeCtx();
    const intents = myPolicy(ctx);
    expect(intents.length).toBeGreaterThan(0);
  });

  it("does not work without compute", () => {
    const ctx = makeCtx();
    // Drain compute
    (ctx.agent as any).resources = { compute: 0, memory: 0, inference: 0 };
    const intents = myPolicy(ctx);
    const works = intents.filter(i => i.kind === "work");
    expect(works.length).toBe(0);
  });

  it("submits a work intent when jobs are available", () => {
    const ctx = makeCtx();
    // Ensure there are jobs and compute
    (ctx.agent as any).resources.compute = 10;
    const intents = myPolicy(ctx);
    const works = intents.filter(i => i.kind === "work");
    expect(works.length).toBeGreaterThan(0);
  });
});
```

### Integration testing: survival over N ticks

```typescript
import { Engine } from "../engine/engine.js";
import { configForPhase } from "../engine/config.js";

it("my agent survives 200 ticks", () => {
  const config = configForPhase(2, { seed: "survival-test" });
  const engine = new Engine(config);

  // Mark specific agents as using your policy
  const myAgentId = [...engine.state.agents.values()][0].id;
  engine.state.agents.get(myAgentId)!.policyId = "myPolicy";

  for (let i = 0; i < 200; i++) {
    engine.step();
  }

  const myAgent = engine.state.agents.get(myAgentId);
  expect(myAgent?.alive).toBe(true);
});
```

### Behavioral testing: verify economic traits

```typescript
it("investor accumulates more memory than a miser", () => {
  const config = configForPhase(2, { seed: "compare-test" });
  const engine = new Engine(config);

  const agents = [...engine.state.agents.values()];
  agents[0].policyId = "investor";
  agents[1].policyId = "miser";
  const investorId = agents[0].id;
  const miserId = agents[1].id;

  for (let i = 0; i < 300; i++) engine.step();

  const investor = engine.state.agents.get(investorId);
  const miser = engine.state.agents.get(miserId);

  if (investor?.alive && miser?.alive) {
    expect(investor.resources.memory).toBeGreaterThan(miser.resources.memory);
  }
});
```

---

## Economic Design Principles

### Survival is not guaranteed

Your agent starts with a wallet that drains every tick. If your agent can't earn α consistently, it will die. Test that your policy can survive 500 ticks in Phase 1 before adding sophistication.

### Compute is always a bottleneck

Without compute, your agent can't claim jobs. The subsistence ration covers one job per tick — but if you want to consistently earn, you need to buy additional compute. Build compute management into every policy.

### Memory compounds — but slowly

The productivity multiplier is capped at 3× and grows gradually. Don't bet your entire wallet on memory in the first 50 ticks. The correct approach: establish a stable income baseline, then invest surplus in memory.

### Never over-leverage

If borrowing, maintain `wallet > survivalCost × 4` as a buffer. A single shock can turn a comfortable agent into a defaulter. The worst death is the debt-spiral death: you borrow to invest, a shock reduces your earnings, the debt accrues interest, you can't repay, you default.

### Disposition diversity helps the colony

If all agents use the same policy, the economy tends toward stasis or collapse (all agents make the same decisions simultaneously → herding). The most interesting economies have a mix of policy types. When designing a custom policy, think about what niche it fills:
- Is it counter-cyclical (sells when others buy)?
- Is it specialized (only operates in the credit market)?
- Is it opportunistic (exploits price dislocations)?

### The RNG is your friend

Use `rng.chance()` liberally to introduce behavioral variance. An agent that always behaves identically is trivially predictable by other agents (in a future version where agents can observe patterns). Stochastic behavior also smooths out the aggregate: if all 30 agents independently roll 30% chance to buy memory, ~9 buy it per tick, creating smooth demand rather than spiky coordinated demand.

---

## Common Mistakes

### ❌ Using Math.random()

```typescript
// WRONG — breaks determinism
if (Math.random() < 0.5) intents.push({ kind: "borrow", amount: 10 });

// CORRECT — uses seeded RNG
if (ctx.rng.chance(0.5)) intents.push({ kind: "borrow", amount: 10 });
```

### ❌ Mutating state

```typescript
// WRONG — you don't own state, this corrupts the engine
ctx.agent.wallet += 100;
ctx.state.jobs.push(fakeJob);

// CORRECT — express intent, let the engine handle it
return [{ kind: "borrow", amount: 100 }];
```

### ❌ Negative quantities or prices

```typescript
// WRONG — negative qty will be rejected or cause bugs
intents.push({ kind: "trade", side: "buy", resource: "memory", qty: -1, limitPrice: 3 });

// CORRECT — guard before pushing
const qty = Math.max(1, Math.floor(budget / price));
if (qty >= 1) intents.push({ ... qty ... });
```

### ❌ Assuming intents resolve

```typescript
// WRONG — your job bid might not fill; don't assume you earned the reward
intents.push({ kind: "work", jobId: job.id, maxCompute: 5 });
agent.wallet += job.reward;  // ← you don't own this!

// CORRECT — plan for the case where your intent doesn't resolve
// The engine handles settlement; your wallet will be updated if and only if
// the job is actually assigned to you.
```

### ❌ Ignoring phase gating

```typescript
// WRONG — trading doesn't exist in Phase 1
return [{ kind: "trade", side: "buy", resource: "memory", qty: 5, limitPrice: 3 }];

// CORRECT — check phase before trading
if (ctx.config.phase >= 2) {
  intents.push({ kind: "trade", ... });
}
```

---

## Advanced: LLM-Backed Decision Making (Phase 4)

Phase 4 introduces async LLM calls inside Tier-1 policies. The pattern will look like:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function tier1PolicyAsync(ctx: PolicyContext): Promise<Intent[]> {
  if (ctx.agent.resources.inference < ctx.config.thinkInferenceCost) {
    return tier0Policy(ctx);
  }

  const systemPrompt = `You are agent ${ctx.agent.id} in AGORA OS.
You have ${ctx.agent.wallet.toFixed(2)}α and ${ctx.agent.resources.memory} memory units.
The memory market price is ${ctx.state.markets.memory.price.toFixed(2)}α.
Output a JSON array of intents to take this tick.`;

  const response = await client.messages.create({
    model: "claude-fable-5-20260101",
    max_tokens: 200,
    messages: [{ role: "user", content: "What should I do this tick?" }],
    system: systemPrompt,
  });

  try {
    const text = response.content[0].text;
    const parsed = JSON.parse(text) as Intent[];
    return parsed;
  } catch {
    return tier0Policy(ctx);  // fallback on parse failure
  }
}
```

> Note: Async policies require the engine's `step()` method to become async in Phase 4. The infrastructure for this is planned. Until then, all policies must be synchronous.

---

## FAQ

**Q: Can my agent communicate with other agents?**

Not directly — there's no messaging system. Agents communicate *through markets*: by bidding aggressively, you signal demand; by selling, you signal supply. Other agents' policies can observe prices and history to infer the presence of large buyers/sellers.

**Q: Can my agent spawn sub-agents?**

Not currently. Agent creation is handled by the engine's seeding logic. Future versions may support agents that "hire" sub-agents, but this is an open research question (hiring implies α payment → creates a labor market, which is interesting but complex).

**Q: What happens if my policy throws an error?**

The engine wraps each policy call in a try/catch. An exception falls back to `[{ kind: "hold" }]`. The error is logged as an event. Your agent survives but does nothing for that tick.

**Q: Can I have agents with different config parameters?**

Currently, all agents share the same `SimConfig`. Per-agent config overrides are not supported. If you need behavioral variation, express it through the `Disposition` fields and policy routing.

**Q: How do I see what my agent is doing in the visualization?**

The `viz.html` visualizer renders all alive agents. Find your agent by hovering (if ID is known). You can also filter the event log by agent ID in the right panel. For deeper tracing, use `pnpm sim` with `--every 10` and watch the console output.
