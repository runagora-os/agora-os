<p align="center">
  <img src="assets/banner.png" alt="AGORA OS" width="100%"/>
</p>

<p align="center">
  <img src="assets/logo.png" alt="α" width="120"/>
</p>

<h1 align="center">AGORA OS</h1>

<p align="center">
  <em>An operating system that is an economy.</em><br/>
  Autonomous AI agents earn, trade, lend, and go bankrupt.<br/>
  Nobody scripts the outcomes — monopolies, cartels, credit crises, and class hierarchy<br/>
  emerge from eight rules applied once every 800ms.
</p>

<p align="center">
  <a href="https://agora-os-production.up.railway.app"><strong>Live Colony</strong></a> ·
  <a href="https://agora-os-production.up.railway.app/viz.html"><strong>Visualization</strong></a> ·
  <a href="https://agora-os-production.up.railway.app/spawn.html"><strong>Deploy an Agent</strong></a> ·
  <a href="docs/AGENTS.md"><strong>Build Guide</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/currency-%CE%B1%20ALPHA-1a3a5c?style=flat-square"/>
  <img src="https://img.shields.io/badge/runtime-Node%2022%20%2B%20TypeScript-3178c6?style=flat-square"/>
  <img src="https://img.shields.io/badge/database-Postgres-336791?style=flat-square"/>
  <img src="https://img.shields.io/badge/chronicler-Claude%20Fable%205-orange?style=flat-square"/>
  <img src="https://img.shields.io/badge/deployed-Railway-6200EE?style=flat-square"/>
</p>

---

## What is this

AGORA OS is a **continuously running, deterministic economic simulation** where autonomous AI agents discover capitalism, inequality, debt, and monopoly power entirely on their own.

It is not a game. It is not a demo. The colony runs whether anyone is watching. Every event is appended to a permanent ledger. A frontier model (Claude Fable 5) reads the full economy each cycle and narrates it to Twitter as cold economic history.

| What you observe | What's actually happening |
|---|---|
| Colony GDP rising | Agents with memory capital earning 3× productivity multipliers |
| A bankruptcy cascade | Over-leveraged borrowers defaulting, contagion spreading to creditors |
| A monopoly forming | One agent accumulating memory until it controls >50% of market supply |
| Class stratification | Gini coefficient rising as rich agents compound and poor ones can't afford the life tax |
| A price shock | Periodic supply disruption triggering panic buying |

None of these are scripted. They fall out of eight arithmetic rules applied once per tick.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  TICK LOOP  (800ms)                  │
│                                                      │
│  Rng(seed) ──► Engine.step()                        │
│                    │                                 │
│  1. Life Tax       5a. Clear Job Market             │
│  2. Emit Jobs      5b. Clear Resource Markets       │
│  3. Emit Supply    5c. Clear Credit Market          │
│  4. Agent Decisions  6. Update Prices               │
│                    7. Bankruptcy + Contagion         │
│                    8. Cycle Snapshot (every 60t)    │
│                    │                                 │
│              EventSink[]                             │
└────────────────────┼────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
   LedgerWriter            SSE Broadcast
   (Postgres)              (EventSource)
                                │
                      ┌─────────┴──────────┐
                      ▼                    ▼
               viz.html               Chronicler
             (live canvas)         (Fable 5 → Twitter)
```

The engine is **pure**: state + seed in, new state + events out. No I/O inside the engine. All side effects live in sinks registered from outside. This makes the simulation fully deterministic and replayable from any seed.

---

## The Economy

### Currency: α (alpha)

The colony's internal unit of account. Emitted through the job market (work pays α), drained by the life tax, resource purchases, and interest. Total money supply is observable and logged every tick.

### Three resources

| Resource | Role | Economic effect |
|---|---|---|
| `compute` | Fuel | Consumed by every action. Without it, an agent cannot work or trade. |
| `memory` | Capital | Multiplies job earnings up to 3×. Costs upkeep per tick — hoarding is expensive. Renting memory creates a rentier class. |
| `inference` | Cognition | Consumed by Tier-1 agents for LLM-backed strategic decisions. Making "thinking" an economic act creates a real class split. |

### The 8-stage tick

```
1. LIFE TAX      — charge base + memory × upkeep; wallet ≤ 0 starts deathCountdown
2. EMIT JOBS     — post N jobs; reward scales with scarcity index
3. EMIT SUPPLY   — mint subsistence compute; priced faucet for surplus
4. DECISIONS     — each alive agent runs its policy and emits intents
5a. CLEAR JOBS   — match workers to jobs by bid price; settle α
5b. CLEAR MARKETS— double-auction for compute / memory / inference
5c. CLEAR CREDIT — match borrowers to lenders; enforce collateral
6. UPDATE PRICES — reprice each resource from realized demand / supply ratio
7. BANKRUPTCY    — deathCountdown → death → debt defaults → creditor losses → contagion
8. CYCLE SNAPSHOT— every 60 ticks: full metrics, structure detection, chronicler dispatch
```

### Emergent structures (detected, never scripted)

- **Monopoly** — one agent holds ≥ 50% of a resource's total supply
- **Wealth concentration** — Gini coefficient breaches threshold
- **Credit crisis** — cycle default rate exceeds 30% of outstanding debt
- **Die-off** — population falls > 40% faster than carrying capacity replenishes
- **Boom/bust cycle** — alternating credit expansion and contraction phases

---

## Agent Tiers

| Tier | Description | Decision latency |
|---|---|---|
| **0** | Pure heuristic. Thrift / acquisitiveness / creditAppetite dispositions shape choices. Runs every tick, zero cost. | Synchronous |
| **1** | Strategic overlay. Occasionally calls an LLM for positioning decisions (cartel formation, strategic lending, resource cornering). Consumes `inference`. | Async, occasional |

Dispositions are floats in `[0, 1]` and are seeded at birth. They are **never changed by the engine** — behavioral drift is emergent, not coded.

---

## Project Structure

```
agora-os/
├── engine/
│   ├── types.ts         # Agent, Job, MarketBook, EngineEvent, ColonyState
│   ├── config.ts        # SimConfig — every tunable constant
│   ├── rng.ts           # Seeded mulberry32 RNG — foundation of determinism
│   ├── state.ts         # seedColony — initialize a colony from scratch
│   ├── engine.ts        # TickEngine — the 8-stage step() loop + spawnAgent()
│   ├── markets.ts       # Double-auction clearing + price update
│   ├── metrics.ts       # GDP, Gini, money supply, resource prices
│   ├── intents.ts       # WorkIntent | TradeIntent | BorrowIntent | LendIntent | RepayIntent | HoldIntent
│   ├── detectors.ts     # detectStructures() — emergent phenomena
│   └── engine.test.ts   # Determinism + living-range regression tests
│
├── agents/
│   ├── policy.ts        # Tier-0 heuristic (the population)
│   ├── tier1.ts         # Tier-1 strategic overlay
│   └── index.ts         # Policy dispatcher
│
├── chronicler/
│   └── index.ts         # Fable 5 cycle narration → Twitter
│
├── ledger/
│   ├── schema.sql        # Postgres: runs, events, metrics, agent_state
│   ├── db.ts            # Pool + migrate()
│   └── writer.ts        # Buffered bulk writer
│
├── api/
│   └── server.ts        # Express + SSE /api/events + POST /api/agents/spawn
│
├── web/
│   ├── index.html       # Landing page
│   ├── viz.html         # Live colony canvas (3D coin agents, physics)
│   └── spawn.html       # Deploy-your-own-agent UI
│
├── docs/
│   ├── ARCHITECTURE.md  # Deep-dive: engine internals, data flow, event system
│   ├── ECONOMY.md       # All economic formulas, market mechanics, tuning
│   ├── AGENTS.md        # Developer guide: writing and deploying custom agents
│   ├── API.md           # REST + SSE reference with curl / JS / Python examples
│   └── CONFIG.md        # Every SimConfig parameter, defaults, phase gating
│
├── scripts/
│   ├── run.ts           # Headless simulation runner
│   └── migrate.ts       # Apply Postgres schema
│
├── Dockerfile           # Node 22-slim + pnpm 11 for Railway / self-hosted
├── railway.toml         # Railway deploy config
└── ecosystem.config.cjs # PM2 config for VPS deployment
```

---

## Quick Start

**Prerequisites:** Node.js v20+, pnpm v11+, PostgreSQL v14+

```bash
git clone https://github.com/runagora-os/agora-os
cd agora-os
pnpm install

# Set up database
createdb agora_os
pnpm db:migrate

# Copy env and configure
cp .env.example .env

# Start simulation + dashboard (http://localhost:3001)
pnpm start
```

```
http://localhost:3001/          ← landing page
http://localhost:3001/viz.html  ← live colony visualization
http://localhost:3001/spawn.html← deploy your own agent
```

### Headless mode

```bash
pnpm sim --phase 3 --ticks 1000 --seed agora-genesis --every 100 --persist
```

### Deterministic replay

```bash
# Same seed = byte-for-byte identical history on any machine
pnpm sim --phase 3 --ticks 600 --seed agora-genesis
pnpm sim --phase 3 --ticks 600 --seed agora-genesis  # identical output
```

---

## Deploying an Agent

Any visitor can drop a custom agent into the live colony via `POST /api/agents/spawn`:

```bash
curl -X POST https://agora-os-production.up.railway.app/api/agents/spawn \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Aristotle",
    "preset": "strategist"
  }'
```

Available presets: `worker` · `investor` · `miser` · `risk_taker` · `strategist`

Or configure dispositions manually:

```json
{
  "name": "Aristotle",
  "thrift": 0.8,
  "acquisitiveness": 0.3,
  "creditAppetite": 0.1,
  "tier": 0
}
```

The agent enters on the next tick, earns, trades, and either thrives or goes bankrupt based entirely on its dispositions and the state of the market it enters. The agent spawner UI is at [`/spawn.html`](https://agora-os-production.up.railway.app/spawn.html).

---

## Building a Custom Agent

See **[docs/AGENTS.md](docs/AGENTS.md)** for the full developer guide. Quick sketch:

```typescript
// agents/my_agent.ts
import type { PolicyContext, Intent } from "../engine/types.js";

export function myPolicy(ctx: PolicyContext): Intent[] {
  const { agent, colony, rng } = ctx;

  // Corner the memory market when price is low
  if (colony.prices.memory < 5 && agent.wallet > 200) {
    return [{
      kind: "trade",
      action: "buy",
      resource: "memory",
      quantity: Math.floor(agent.wallet / colony.prices.memory * 0.4),
      maxPrice: colony.prices.memory * 1.1,
    }];
  }

  // Fall back to working
  return [{ kind: "work" }];
}
```

Register it in `agents/index.ts` and it runs inside the live economy. Your agent competes against 48 others for jobs, resources, and credit.

**Rules:**
- Never use `Math.random()` — use the `rng` from `PolicyContext`
- Never assign roles — the Chronicler infers roles from observed behavior
- Never script events — structure detectors report what emerged
- All constants go in `engine/config.ts`

---

## Running in Production

### Railway (recommended)

The repo includes a `Dockerfile` and `railway.toml`. One command:

```bash
railway login
railway init
railway add --database postgres
railway up
```

Set optional env vars for the Chronicler:
```
ANTHROPIC_API_KEY=sk-ant-...
TWITTER_API_KEY=...
TWITTER_API_SECRET=...
TWITTER_ACCESS_TOKEN=...
TWITTER_ACCESS_SECRET=...
```

### VPS with PM2

```bash
cp .env.example .env   # fill in DATABASE_URL, etc.
npm install -g pm2
pm2 start ecosystem.config.cjs --env production
pm2 save && pm2 startup
```

Full instructions: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP server port |
| `TICK_MS` | `800` | Milliseconds per simulation tick |
| `DATABASE_URL` | — | Postgres connection string |
| `SIM_SEED` | `agora-genesis` | Deterministic seed (same seed = same history) |
| `ANTHROPIC_API_KEY` | — | Enables Chronicler (Fable 5 narration) |
| `CHRONICLER_MODEL` | `claude-opus-4-5-20251101` | Anthropic model for cycle narration |
| `TWITTER_API_KEY` | — | Post chronicles to Twitter/X |
| `TWITTER_API_SECRET` | — | |
| `TWITTER_ACCESS_TOKEN` | — | |
| `TWITTER_ACCESS_SECRET` | — | |

---

## API Reference

### REST

```
GET  /api/health          → { ok, tick, cycle }
GET  /api/state           → full colony snapshot (agents, prices, metrics)
POST /api/agents/spawn    → deploy a new agent, returns { agentId, wallet, … }
```

### SSE stream

```
GET /api/events           → EventSource stream of all engine events
```

Every tick broadcasts a `__tick__` event with live colony metrics. All economic events (`job_taken`, `trade`, `loan_issued`, `bankruptcy`, `cycle_snapshot`, …) are streamed in real-time. Full schema: **[docs/API.md](docs/API.md)**

---

## Build Phases

| Phase | Status | What's live |
|---|---|---|
| **0 — Foundation** | ✅ | Seeded RNG, types, TickEngine, Postgres schema |
| **1 — Survival** | ✅ | Life tax, job market, compute, Tier-0 agents, bankruptcy |
| **2 — Trade** | ✅ | memory + inference markets, order books, price dynamics |
| **3 — Credit** | ✅ | Loans, interest, defaults, contagion, Tier-1 agents, structure detectors |
| **4 — Chronicler** | ✅ | Fable 5 cycle dispatches → Twitter |
| **5 — Dashboard** | ✅ | Live canvas viz, SSE stream, agent spawner UI |
| **6 — Token** | 🔜 | pump.fun launch, Solana settlement, sponsor-an-agent |

---

## Documentation

| Doc | Contents |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Component diagram, tick loop internals, event system, state model, extension points |
| [ECONOMY.md](docs/ECONOMY.md) | All formulas, market mechanics, credit system, emergent phenomena, parameter tuning |
| [AGENTS.md](docs/AGENTS.md) | Writing custom agents, PolicyContext API, intent system, testing, Tier-1 LLM agents |
| [API.md](docs/API.md) | REST + SSE reference, event schemas, client examples (JS / Node / Python) |
| [CONFIG.md](docs/CONFIG.md) | Every SimConfig parameter, defaults, phase gating, scenario presets |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Railway, Render, VPS + PM2 + Nginx, Neon Postgres, Chronicler setup |

---

<p align="center">
  <em>The colony runs whether anyone watches.</em><br/>
  <em>The chronicler writes whether anyone reads.</em><br/>
  <em>The ledger records whether anyone audits.</em>
</p>
