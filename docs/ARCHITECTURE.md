# AGORA OS — Architecture

## Overview

AGORA OS is structured as a **pure deterministic engine** with a set of stateless side-effect adapters around it. The guiding principle is that the engine must be fully testable without any I/O: no database, no network, no timers. Everything that touches the outside world is wired in from `api/server.ts` or `scripts/run.ts`.

```
┌─────────────────────────────────────────────────────────────────┐
│                         AGORA OS                                │
│                                                                 │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                   CORE ENGINE (pure)                     │  │
│   │                                                          │  │
│   │   engine/rng.ts          Seeded PRNG (mulberry32)        │  │
│   │   engine/types.ts        Domain types                    │  │
│   │   engine/config.ts       SimConfig + presets             │  │
│   │   engine/state.ts        Colony initialization           │  │
│   │   engine/engine.ts       TickEngine — the 8-stage loop   │  │
│   │   engine/markets.ts      Order book clearing + pricing   │  │
│   │   engine/metrics.ts      Aggregate stats (Gini, GDP…)    │  │
│   │   engine/intents.ts      Intent types                    │  │
│   │   engine/detectors.ts    Emergent structure detection    │  │
│   │                                                          │  │
│   │   agents/policy.ts       Tier-0 heuristic policy         │  │
│   │   agents/tier1.ts        Tier-1 strategic overlay        │  │
│   │   agents/index.ts        Policy dispatcher               │  │
│   └───────────────────────────┬──────────────────────────────┘  │
│                               │ EventSink[]                     │
│              ┌────────────────┼────────────────┐                │
│              ▼                ▼                ▼                │
│     ┌────────────────┐  ┌──────────┐  ┌──────────────────┐     │
│     │  ledger/       │  │  api/    │  │  chronicler/     │     │
│     │  writer.ts     │  │  server  │  │  (Fable 5)       │     │
│     │  Postgres bulk │  │  SSE +   │  │  Twitter post    │     │
│     │  insert        │  │  REST    │  │  per cycle       │     │
│     └────────────────┘  └──────────┘  └──────────────────┘     │
│                               │                                 │
│                         ┌─────▼──────┐                          │
│                         │  web/      │                          │
│                         │  viz.html  │                          │
│                         │  index.html│                          │
│                         └────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Types (`engine/types.ts`)

### Agent

The primary entity in the simulation.

```typescript
interface Agent {
  id: AgentId;               // "agent-0042"
  wallet: number;            // α balance (can go negative within deathGrace)
  resources: ResourceBundle; // { compute, memory, inference }
  debts: Debt[];             // active loan obligations
  tier: 0 | 1;               // 0 = heuristic-only, 1 = LLM-capable
  disposition: Disposition;  // innate behavioral biases (set once at birth)
  age: number;               // ticks since birth
  alive: boolean;
  deathCountdown: number;    // ticks remaining before death (counts from deathGrace)
}
```

### Disposition

Each agent is born with a fixed personality vector that biases its heuristics. Dispositions are not overridable at runtime — they express the diversity of the agent population.

```typescript
interface Disposition {
  riskTolerance: number;    // 0–1: high = more aggressive trading
  acquisitiveness: number;  // 0–1: high = more memory accumulation
  creditAppetite: number;   // 0–1: high = borrow more readily
}
```

### ResourceBundle

```typescript
type ResourceKind = "compute" | "memory" | "inference";

interface ResourceBundle {
  compute: number;
  memory: number;
  inference: number;
}
```

### Job

Units of economic demand. Emitted by the engine each tick; claimed by agents in the clearing stage.

```typescript
interface Job {
  id: string;
  reward: number;      // α paid on completion
  computeCost: number; // compute consumed by the worker
  ttl: number;         // ticks until expiry if unclaimed
  claimedBy?: AgentId;
}
```

### MarketBook

Per-resource double-auction state.

```typescript
interface MarketBook {
  resource: ResourceKind;
  bids: Order[];   // buy orders, sorted descending by price
  asks: Order[];   // sell orders, sorted ascending by price
  price: number;   // last clearing price
  history: number[]; // recent price history (priceHistoryLen entries)
}
```

### EngineEvent

The engine's entire output is a stream of typed events. Nothing is mutated outside — every observable state change produces an event.

```typescript
type EventType =
  | "life_tax"         // agent charged survival tax
  | "job_offered"      // new job posted to the market
  | "job_completed"    // worker received reward
  | "job_expired"      // unclaimed job removed
  | "resource_traded"  // resource order matched
  | "price_updated"    // market price moved
  | "loan_issued"      // new debt created
  | "loan_repaid"      // debt partially/fully paid
  | "loan_defaulted"   // agent died with outstanding debt
  | "agent_died"       // wallet hit zero, grace expired
  | "shock"            // periodic supply disruption
  | "cycle_snapshot";  // end-of-cycle aggregate snapshot

interface EngineEvent {
  id: number;
  tick: number;
  type: EventType;
  payload: Record<string, unknown>;
}
```

### ColonyState

The full simulation state. Passed into every policy call (read-only) and mutated exclusively by the engine's step() method.

```typescript
interface ColonyState {
  tick: number;
  cycle: number;
  agents: Map<AgentId, Agent>;
  markets: Record<ResourceKind, MarketBook>;
  jobs: Job[];
  debts: Map<string, Debt>;
  reclaimed: ResourceBundle; // resources from dead agents, re-sold over time
  nextIds: { agent, job, order, debt, event: number };
}
```

---

## The Tick Loop (`engine/engine.ts`)

Every call to `engine.step()` executes these eight stages in sequence:

### Stage 1 — Life Tax

```
for each alive agent:
  charge = config.lifeTaxBase + agent.resources.memory × config.memoryUpkeep
  agent.wallet -= charge
  emit "life_tax"
```

This is the primary sink. Without continuous income, agents die. Memory costs extra to maintain, making hoarding expensive and productive only if memory generates enough extra income to cover its upkeep.

### Stage 2 — Emit Jobs

```
N = clamp(
  jobBaseCount + jobsPerAgent × alive_count,
  jobsPerTick.min,
  jobsPerTick.max
)
post N new jobs with:
  reward ∈ [jobBaseReward × 0.7, jobBaseReward × 1.3]
  computeCost ∈ [jobComputeCost.min, jobComputeCost.max]
  ttl = config.jobTtl
```

`jobBaseCount` sets a roughly fixed carrying capacity (total income the market can sustain). `jobsPerAgent` adds a small population-dependent term so the economy "breathes" slightly with population. This prevents both stasis (everyone survives easily) and wipeout (nobody can earn enough).

### Stage 3 — Emit Supply (Phase 2+)

```
for each alive agent:
  agent.resources.compute += config.subsistenceCompute  // free ration

if phase >= 2:
  faucet prices = marketPrice × faucetMarkup
  sell computeMintPerTick units at faucet price (from reclaimed pool)
  sell memoryMintPerTick units at faucet price
  sell inferenceMintPerTick units at faucet price

  // Drip reclaimed resources onto the market
  drip fraction of reclaimed back into supply
```

The subsistence compute ration (free) ensures every agent can always perform at least one job per tick regardless of wealth, preventing a poverty trap where agents can't afford fuel to earn income to buy fuel.

### Stage 4 — Decisions

```
for each alive agent (randomized order):
  ctx = { agent, state, config, rng }
  intents = dispatchPolicy(ctx)   // → agents/index.ts
  // intents are queued; not yet resolved
```

The random ordering prevents consistent "early mover advantage" that would distort results.

### Stage 5 — Market Clearing

Three parallel clearing passes:

**5a. Job clearing:**
```
sort open jobs by reward DESC
for each job:
  for each willing worker (shuffled):
    if worker has enough compute:
      assign job to worker
      worker.wallet += job.reward × productivity(worker)
      worker.resources.compute -= job.computeCost
      break
```

Note that job *access* is a fair lottery (shuffled), but job *yield* depends on memory capital (productivity multiplier). This produces wealth stratification without starving poor agents of work opportunities.

**5b. Resource market clearing (double auction):**
```
for each resource market:
  sort bids DESC by price, asks ASC by price
  while bids[0].price >= asks[0].price:
    match at midpoint price
    transfer resource, transfer α
    emit "resource_traded"
```

**5c. Credit clearing (Phase 3):**
```
for each BorrowIntent:
  create Debt { principal, interestRate, term }
  agent.wallet += principal
  emit "loan_issued"

for each RepayIntent:
  reduce Debt.outstanding by min(amount, outstanding)
  if outstanding == 0: close debt
  emit "loan_repaid"
```

### Stage 6 — Price Update

```
for each resource market:
  demand = bids volume this tick
  supply = asks volume this tick
  pressure = (demand - supply) / max(supply, 1)
  newPrice = clamp(
    price × (1 + pressure × priceK),
    priceBounds[resource].min,
    priceBounds[resource].max
  )
  update price history
  emit "price_updated"
```

### Stage 7 — Bankruptcy

```
for each alive agent:
  if wallet > 0:
    deathCountdown = config.deathGrace  // reset grace
  else:
    deathCountdown--
    if deathCountdown <= 0:
      agent.alive = false
      reclaimed += agent.resources  // return resources to the system
      for each debt: defaulted creditors take a loss
      emit "agent_died"
```

Defaulted debts do not destroy α — they transfer the loss to creditors, who may themselves enter distress. This is how credit crises cascade.

### Stage 8 — Cycle Snapshot

Every `ticksPerCycle` ticks:
```
compute ColonyMetrics (Gini, GDP, money supply, alive, avg debt…)
detect structures (monopoly, class crisis, die-off…)
emit "cycle_snapshot"
persist to Postgres if --persist
call Chronicler if API key available
```

---

## Event System

The engine exposes an `onEvent(cb)` method. Any number of sinks can subscribe:

```typescript
const engine = new Engine(config);

// Sink 1: SSE broadcast
engine.onEvent((ev) => {
  for (const res of sseClients) res.write(`data: ${JSON.stringify(ev)}\n\n`);
});

// Sink 2: buffered Postgres writes
const writer = new LedgerWriter(pool, runId);
engine.onEvent((ev) => writer.push(ev));
```

The engine itself never knows about its sinks. This makes it trivial to add new consumers (analytics, alerting, Discord webhooks, etc.) without touching the simulation logic.

---

## Determinism and Replayability

The engine uses a **seeded PRNG** (`mulberry32` — fast, splittable, well-distributed) rooted at the configured seed. Every source of randomness in the simulation draws from this single tree:

```
root RNG (seed string → uint32)
  ├── agent-RNGs (one per agent, forked at birth)
  │     └── disposition generation
  │     └── policy decisions (which job to pick, trade aggressiveness…)
  ├── job emission (reward amounts, compute costs)
  ├── supply faucet shuffle
  └── worker queue shuffle
```

**No `Math.random()` is ever called inside the engine or agent policies.** This is enforced by code review convention (a linter rule should be added). The consequence: given the same seed and config, the simulation produces the **exact same event stream** on any machine, at any time, in any order of execution.

This replayability is what makes the ledger *auditable* — anyone can verify a claimed history by replaying from the seed.

---

## Persistence Layer (`ledger/`)

The Postgres schema is **append-only by convention**. Rows are never updated or deleted after insertion.

### Tables

| Table | Contents |
|---|---|
| `runs` | One row per simulation run: seed, phase, config JSON, start time |
| `events` | Every `EngineEvent` emitted during the run |
| `metrics` | `ColonyMetrics` snapshot per cycle |
| `agent_state` | Agent state snapshot at each cycle (for forensics) |

### LedgerWriter

Writes are **buffered and batched** to avoid per-event DB round trips. The writer collects events in memory and flushes every N events or M milliseconds (whichever comes first). This allows the engine to run at full speed without I/O blocking.

```typescript
const writer = new LedgerWriter(pool, runId);

// Engine fires events — writer queues them
engine.onEvent((ev) => writer.push(ev));

// Periodic flush (writer does this automatically)
// On process exit, call writer.flush() for final drain
```

---

## API Server (`api/server.ts`)

The server has three responsibilities:

1. **Run the simulation** (one Engine instance, one `setInterval` at `TICK_MS`)
2. **Serve the web frontend** (static files from `web/`)
3. **Expose the simulation state** to browser clients (REST snapshot + SSE stream)

See [API.md](API.md) for full endpoint documentation.

### SSE protocol

The browser connects to `GET /api/events` and receives a continuous stream of JSON objects:

```
data: {"type":"job_completed","tick":142,"payload":{...}}\n\n
data: {"type":"__tick__","tick":143,"alive":28,"gini":0.31,...}\n\n
data: {"type":"resource_traded","tick":143,"payload":{...}}\n\n
```

The `__tick__` synthetic event is broadcast once per tick regardless of whether anything happened, so the visualization can always update its gauges.

---

## Adding New Components

### A new emergent structure detector

Add a function to `engine/detectors.ts`:

```typescript
export function detectCartel(state: ColonyState): string | null {
  // Return a description string if cartel detected, null otherwise
  const topThree = topAgentsByResource(state, "memory", 3);
  const combined = topThree.reduce((s, a) => s + a.resources.memory, 0);
  const total = totalResource(state, "memory");
  if (combined / total > 0.7) {
    return `Cartel: ${topThree.map(a => a.id).join(", ")} control ${pct(combined/total)} of memory`;
  }
  return null;
}
```

Then call it in `engine.ts`'s cycle snapshot stage and emit via the event system.

### A new event type

1. Add to the `EventType` union in `engine/types.ts`
2. Call `this.emit(events, "your_event_type", { ...payload })` inside the engine
3. Handle in `web/viz.html` if it needs visual feedback
4. Handle in `api/server.ts` if it needs filtering/transformation for the client

### A new resource kind

1. Add to `type ResourceKind` in `engine/types.ts`
2. Add an initial price to `SimConfig.initialPrices` in `engine/config.ts`
3. Add a market book entry in `engine/state.ts:seedColony`
4. Implement supply logic in `engine/engine.ts:emitSupply`
5. Implement demand logic in `agents/policy.ts` (where should agents want this resource?)
6. Add to `web/viz.html` price panel
