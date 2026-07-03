# AGORA OS — Configuration Reference

All simulation constants live in `engine/config.ts`. There are **zero magic numbers** in the engine code — every tunable value is defined here and passed via `SimConfig`.

## Using `configForPhase`

The primary entry point for configuration:

```typescript
import { configForPhase } from "./engine/config.js";

// Phase 1 — survival only (jobs, life tax, bankruptcy)
const cfg1 = configForPhase(1);

// Phase 2 — adds resource trade (compute, memory, inference markets)
const cfg2 = configForPhase(2);

// Phase 3 — adds credit (loans, defaults, contagion)
const cfg3 = configForPhase(3);

// Override specific parameters
const custom = configForPhase(3, {
  seed: "my-run-001",
  initialAgents: 100,
  lifeTaxBase: 0.8,
  shockEveryTicks: 90,
});
```

`configForPhase` enables mechanics progressively:
- **Phase 1:** Jobs + survival only. `supplyEnabled = false`, `creditEnabled = false`.
- **Phase 2:** + resource markets. `supplyEnabled = true`, 0% Tier-1 agents.
- **Phase 3:** + credit system + Tier-1 agents. `creditEnabled = true`, 10% Tier-1 fraction.

---

## Full Parameter Reference

### Core

| Parameter | Default | Description |
|---|---|---|
| `seed` | `"agora-genesis"` (from `SIM_SEED` env) | Deterministic seed for all RNG. Any string; hash-mapped to uint32. The same seed always produces identical history. |
| `ticksPerCycle` | `60` | Number of ticks per cycle. A cycle triggers: Chronicler narration, cycle snapshot event, on-chain anchoring (Phase 6). Shorter cycles = more frequent narration; longer = richer episodes. |
| `phase` | `1` | Active mechanics. `1` = survival, `2` = +trade, `3` = +credit. Not all config parameters are used in all phases; phase gating is checked at runtime. |

---

### Survival Parameters (all phases)

These govern the cost of existence and the basic "keep the agent alive" mechanics.

| Parameter | Default | Type | Description |
|---|---|---|---|
| `lifeTaxBase` | `1` | `number` | α charged to every alive agent each tick, regardless of resources. This is the primary economic sink. Raise this to increase turnover and drama; lower it for a more stable colony. |
| `memoryUpkeep` | `0.05` | `number` | α per unit of memory per tick. Holding memory is expensive. At 0.05 and 20 memory units, an agent pays 1α/tick in upkeep alone. This prevents hoarding without economic purpose: you must earn enough from the productivity bonus to justify the upkeep cost. |
| `actionComputeCost` | `1` | `number` | Compute deducted per agent action (not currently enforced per-action, reserved for Phase 2+ detailed accounting). |
| `thinkInferenceCost` | `1` | `number` | Inference consumed when a Tier-1 agent makes an LLM-backed strategic decision. Making "thinking" expensive creates a real class split between Tier-0 and Tier-1 agents. |
| `deathGrace` | `3` | `number` | Ticks an agent survives after wallet hits ≤ 0 before being removed. A grace period of 3 means an agent has 3 chances to earn α before death. This prevents instant death from rounding errors and allows brief recoveries. |

**Tuning note:** The key survival equation is:

```
min income to survive = lifeTaxBase + memory × memoryUpkeep
```

If `lifeTaxBase = 1` and average job reward is `3α`, an agent can survive the life tax with one successful job every 3 ticks (or every tick if the job competition is low). Adding memory upkeep raises this floor proportionally.

---

### Population Seeding

These parameters control the initial population state. They affect the character of the early game but not the long-run equilibrium (the economy will find its own equilibrium regardless of starting conditions, given the same carrying capacity constraints).

| Parameter | Default | Type | Description |
|---|---|---|---|
| `initialAgents` | `50` | `number` | Population at tick 0. Starts above carrying capacity intentionally — the die-off of the first 100 ticks is the first act of the drama. |
| `startingWallet.min` | `20` | `number` | Minimum starting α. |
| `startingWallet.max` | `60` | `number` | Maximum starting α. Uniform distribution. |
| `startingCompute.min` | `5` | `number` | Minimum starting compute. |
| `startingCompute.max` | `20` | `number` | Maximum starting compute. |
| `startingMemory.min` | `0` | `number` | Minimum starting memory. Zero means some agents start as pure laborers. |
| `startingMemory.max` | `5` | `number` | Maximum starting memory. Small starting endowment; significant accumulation happens during the run. |
| `startingInference.min` | `0` | `number` | Minimum starting inference. |
| `startingInference.max` | `5` | `number` | Maximum starting inference. |
| `tier1Fraction` | `0.0` (Phase 1/2), `0.1` (Phase 3) | `number` | Fraction of the initial population that is Tier-1 (LLM-capable). At 0.1, roughly 5 of 50 agents are Tier-1. |

---

### Job Market (Phase 1+)

The job market is the primary income mechanism. Its structure determines the colony's carrying capacity.

| Parameter | Default | Type | Description |
|---|---|---|---|
| `jobBaseCount` | `8` | `number` | Fixed jobs emitted per tick regardless of population. This is the primary determinant of carrying capacity: the colony can sustain at most `(jobBaseCount × jobBaseReward) / lifeTaxBase` agents in long-run equilibrium. |
| `jobsPerAgent` | `0.06` | `number` | Additional jobs per alive agent per tick. Keeps `total_jobs ≈ 8 + 0.06 × alive`, so as population shrinks the job market shrinks slightly too. Keep this small (`<0.1`) to avoid runaway growth where more population → more jobs → more income → more survival. |
| `jobsPerTick.min` | `3` | `number` | Hard floor on jobs per tick. Prevents market collapse during die-offs. |
| `jobsPerTick.max` | `40` | `number` | Hard ceiling on jobs per tick. Prevents absurd job flooding. |
| `jobBaseReward` | `3` | `number` | Base reward per completed job (α). Actual rewards sampled from `[0.7, 1.3] × jobBaseReward`. This determines the income available to the colony. |
| `jobComputeCost.min` | `1` | `number` | Minimum compute burned per job completion. |
| `jobComputeCost.max` | `3` | `number` | Maximum compute burned per job completion. Agents with only subsistence compute (`subsistenceCompute = 3`) can still claim max-cost jobs but will deplete their ration entirely. |
| `jobTtl` | `5` | `number` | Ticks before an unclaimed job expires. Short TTL creates urgency; long TTL creates a backlog that can cause burst income when many agents become active simultaneously. |

**Carrying capacity formula:**

```
max_sustainable_population ≈ jobBaseCount × jobBaseReward / lifeTaxBase
                           = 8 × 3 / 1
                           = 24 agents (default Phase 1)
```

Starting with 50 agents and a carrying capacity of ~24 produces the initial die-off that defines the early drama.

---

### Resource Supply (Phase 2+)

| Parameter | Default | Type | Description |
|---|---|---|---|
| `subsistenceCompute` | `3` | `number` | Free compute given to every alive agent each tick, in all phases. This ration covers roughly one full job (`jobComputeCost.max = 3`). It prevents the poverty trap: agents can always earn, even if they have no α to buy fuel. Do not set this to zero — it causes immediate population collapse in Phase 1+. |
| `computeMintPerTick` | `30` | `number` | Additional compute sold by the system faucet each tick (Phase 2+). Agents can buy this at `faucetMarkup × spotPrice`. Provides a reliable compute supply above subsistence. |
| `memoryMintPerTick` | `8` | `number` | Memory posted for sale by the faucet per tick. Low rate creates scarcity, enabling monopoly formation. Higher rate creates abundant capital, reducing stratification. |
| `inferenceMintPerTick` | `3` | `number` | Inference posted by the faucet per tick. Inference is intentionally scarce to make Tier-1 cognition expensive. |
| `faucetMarkup` | `0.9` | `number` | Faucet posts at `spotPrice × faucetMarkup`. Default `0.9` means faucet sells slightly *below* spot (undercuts the market). This ensures faucet supply actually gets purchased. Set to `>1.0` to make the faucet a "last resort" buyer. |
| `supplyEnabled` | `false` | `boolean` | Whether the resource faucet is active. Automatically `true` in Phase 2+. |

---

### Memory as Capital (Phase 2+)

| Parameter | Default | Type | Description |
|---|---|---|---|
| `memoryProductivity` | `0.03` | `number` | Multiplier on job reward per unit of memory: `effectiveReward = reward × min(maxProductivityMult, 1 + memory × memoryProductivity)`. At 0.03, an agent with 33 memory earns `1 + 33 × 0.03 = 2.0×` their base reward. |
| `maxProductivityMult` | `3` | `number` | Cap on the productivity multiplier. At the default, no agent earns more than 3× the base job reward, regardless of memory held. The cap prevents winner-take-all dynamics where the first agent to accumulate memory can outpace everyone else infinitely. To reach the cap: `memory ≥ (3-1) / 0.03 = 67 units`. |
| `computeTargetBuffer` | `8` | `number` | Target compute level that Tier-0 agents try to maintain. When `agent.resources.compute < computeTargetBuffer`, the agent buys compute on the market. Lower values → agents accept more fuel risk; higher values → agents spend more on compute, leaving less for memory investment. |

**Productivity vs. upkeep breakeven:**

For memory to be worth holding, the extra income must exceed the upkeep:

```
extra_income_per_tick = jobBaseReward × memoryProductivity × memory_units × (job_probability)
upkeep_per_tick = memoryUpkeep × memory_units

Breakeven: job_probability > memoryUpkeep / (jobBaseReward × memoryProductivity)
         = 0.05 / (3 × 0.03)
         = 0.56
```

So memory is profitable if the agent wins a job >56% of ticks. Since carrying capacity means ~50-70% job success rates at equilibrium, memory is marginally profitable for most agents and highly profitable for those who work consistently.

---

### Pricing (Phase 2+)

| Parameter | Default | Type | Description |
|---|---|---|---|
| `priceK` | `0.15` | `number` | Price elasticity. After each clearing, price moves by `pressure × priceK`. At 0.15, a 10% excess demand spike moves the price 1.5%. Lower = sluggish prices (markets don't respond quickly to demand); higher = volatile prices (prone to price spirals). |
| `priceHistoryLen` | `20` | `number` | Number of recent prices kept in `market.history[]`. The moving average used by agents for decision-making is computed over this window. Longer window = smoother signals, slower trend detection. |
| `priceBounds.compute` | `{ min: 0.25, max: 20 }` | `object` | Hard floor and ceiling for the compute price. Prevents extreme price collapse (agents always value compute for fuel) or extreme inflation. |
| `priceBounds.memory` | `{ min: 0.5, max: 15 }` | `object` | Memory price bounds. Floor prevents memory from becoming worthless; ceiling prevents it from becoming unaffordable for new agents. |
| `priceBounds.inference` | `{ min: 1, max: 60 }` | `object` | Inference price bounds. Inference is intentionally expensive at its ceiling. |
| `initialPrices.compute` | `1` | `number` | Starting price for compute (α per unit). |
| `initialPrices.memory` | `4` | `number` | Starting price for memory (α per unit). |
| `initialPrices.inference` | `5` | `number` | Starting price for inference (α per unit). |

---

### Credit System (Phase 3)

| Parameter | Default | Type | Description |
|---|---|---|---|
| `creditEnabled` | `false` | `boolean` | Whether the credit system is active. Automatically `true` in Phase 3. |
| `loanRate` | `0.01` | `number` | Per-tick compound interest rate. At 1%, a loan of 10α grows to 10 × 1.01^30 ≈ 13.5α after 30 ticks. |
| `loanTerm` | `30` | `number` | Ticks until a loan is "soft due." After term, nothing forces repayment — the debt continues accruing interest until the agent chooses to repay or dies. |
| `maxLoanToWallet` | `1.5` | `number` | Maximum loan size as a multiple of the agent's current wallet. An agent with 10α can borrow at most 15α. Prevents agents from taking arbitrarily large loans. |

**Debt dynamics:**

At default settings, an agent borrowing 15α at tick 100 that dies at tick 130 (30 ticks later) defaults on:
```
15 × 1.01^30 ≈ 20.2α
```

This 20.2α loss is passed to the lender (the colony's credit pool or a specific creditor in future P2P lending). If the lender's wallet drops below zero from these losses, they begin their own death countdown — the contagion mechanism.

---

### Anti-Equilibrium Guards

| Parameter | Default | Type | Description |
|---|---|---|---|
| `minJobFloor` | `4` | `number` | Minimum open jobs in the queue at any time. If fewer than this are available, the engine tops up to this amount. Prevents the economy from completely stalling when all recent jobs have been claimed. |
| `shockEnabled` | `true` | `boolean` | Whether periodic supply shocks are applied. |
| `shockEveryTicks` | `120` (Phase 2), `180` (Phase 3) | `number` | Ticks between shocks. `0` disables. Shorter cadence = more volatile, less predictable; longer cadence = rare but severe disruptions. |
| `shockMagnitude` | `0.3` | `number` | Severity of each shock. `0.3` reduces available supply by up to 30% and spikes prices proportionally. |

---

## Default Values Quick Reference

```typescript
const DEFAULT_CONFIG: SimConfig = {
  seed: "agora-genesis",
  ticksPerCycle: 60,

  // Survival
  lifeTaxBase: 1,
  memoryUpkeep: 0.05,
  actionComputeCost: 1,
  thinkInferenceCost: 1,
  deathGrace: 3,

  // Population
  initialAgents: 50,
  startingWallet: { min: 20, max: 60 },
  startingCompute: { min: 5, max: 20 },
  startingMemory: { min: 0, max: 5 },
  startingInference: { min: 0, max: 5 },
  tier1Fraction: 0.0,

  // Job market
  jobBaseCount: 8,
  jobsPerAgent: 0.06,
  jobsPerTick: { min: 3, max: 40 },
  jobBaseReward: 3,
  jobComputeCost: { min: 1, max: 3 },
  jobTtl: 5,

  // Supply
  subsistenceCompute: 3,
  computeMintPerTick: 30,
  memoryMintPerTick: 8,
  inferenceMintPerTick: 3,
  faucetMarkup: 0.9,
  supplyEnabled: false,

  // Capital
  memoryProductivity: 0.03,
  maxProductivityMult: 3,
  computeTargetBuffer: 8,

  // Pricing
  priceK: 0.15,
  priceHistoryLen: 20,
  priceBounds: {
    compute: { min: 0.25, max: 20 },
    memory: { min: 0.5, max: 15 },
    inference: { min: 1, max: 60 },
  },
  initialPrices: { compute: 1, memory: 4, inference: 5 },

  // Credit
  creditEnabled: false,
  loanRate: 0.01,
  loanTerm: 30,
  maxLoanToWallet: 1.5,

  // Guards
  minJobFloor: 4,
  shockEnabled: true,
  shockEveryTicks: 120,
  shockMagnitude: 0.3,

  phase: 1,
};
```

---

## Tuning Guide

### Scenario: More dramatic die-offs

```typescript
configForPhase(3, {
  lifeTaxBase: 1.5,           // higher survival cost
  jobBaseReward: 2.5,         // lower income per job
  deathGrace: 1,              // less time to recover
  shockEveryTicks: 80,        // more frequent shocks
});
```

**Expected:** Population drops more sharply after shocks. Gini spikes quickly. Credit crisis events more frequent.

### Scenario: Persistent monopoly

```typescript
configForPhase(2, {
  memoryProductivity: 0.05,   // memory more productive
  maxProductivityMult: 5,     // higher ceiling
  memoryMintPerTick: 3,       // scarce memory supply
  memoryUpkeep: 0.01,         // cheap to hold
});
```

**Expected:** One or two agents accumulate most of the memory supply. Gini reaches 0.6+. Monopoly detector fires within 200 ticks.

### Scenario: Stable wealthy colony (for demos)

```typescript
configForPhase(2, {
  lifeTaxBase: 0.5,           // lower survival cost
  jobBaseCount: 20,            // abundant jobs
  jobBaseReward: 4,            // generous rewards
  shockEnabled: false,         // no disruptions
  creditEnabled: false,        // no debt risk
});
```

**Expected:** Most of the initial 50 agents survive. Gradual stratification without catastrophes. Good for a "stable economy" visualization.

### Scenario: Credit crisis simulation

```typescript
configForPhase(3, {
  loanRate: 0.02,             // higher interest
  maxLoanToWallet: 3,          // agents can over-leverage
  shockEveryTicks: 60,         // frequent shocks to trigger defaults
  loanTerm: 20,                // shorter terms
});
```

**Expected:** Credit expansion followed by cascade defaults when shocks hit over-leveraged agents. Credit crisis detector fires. Chronicler narrates the collapse.

### Scenario: Studying trade dynamics only

```typescript
configForPhase(2, {
  creditEnabled: false,        // isolate from credit effects
  shockEnabled: false,         // steady-state markets
  initialAgents: 30,           // smaller, cleaner population
  memoryMintPerTick: 4,        // moderate supply
});
```

**Expected:** Clean price discovery curves. Memory price stabilizes based on supply/demand balance. Good for studying market mechanics in isolation.

---

## Parameter Sweep Example

The living range tests in `engine/engine.test.ts` demonstrate how to sweep parameters programmatically:

```typescript
function sweep(param: keyof SimConfig, values: number[]) {
  return values.map(v => {
    const engine = new Engine(configForPhase(2, { [param]: v }));
    for (let i = 0; i < 400; i++) engine.step();
    const m = engine.step().metrics;
    return { [param]: v, alive: m.aliveAgents, gini: m.gini };
  });
}

// Sweep lifeTaxBase
const results = sweep("lifeTaxBase", [0.3, 0.5, 0.8, 1.0, 1.5, 2.0]);
console.table(results);
```

This is the primary tool for finding the "living range" — the parameter space where the economy neither collapses nor freezes.
