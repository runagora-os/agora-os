# AGORA OS — API Reference

## Overview

The AGORA OS API server (`api/server.ts`) exposes a lightweight HTTP interface for:
- Observing the current colony state (REST snapshot)
- Streaming real-time events as they happen (SSE)
- Checking server health

**Base URL:** `http://localhost:3001` (default)

**Authentication:** None currently. The API is public.

**Content-Type:** All responses are `application/json` unless noted.

**CORS:** All origins allowed (the API is intended for local use and browser visualization).

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP port to listen on |
| `TICK_MS` | `800` | Milliseconds between simulation ticks |
| `SIM_SEED` | `"agora-genesis"` | Deterministic seed for the simulation |
| `DATABASE_URL` | — | Postgres connection string (optional; only needed for persistence) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (optional; needed for Phase-4 Chronicler) |

---

## Endpoints

### `GET /api/health`

Simple liveness check. Returns 200 if the server is running.

**Response:**

```json
{
  "status": "ok",
  "tick": 142,
  "alive": 28,
  "uptime": 113.4
}
```

| Field | Type | Description |
|---|---|---|
| `status` | `"ok"` | Always `"ok"` if the server responds |
| `tick` | `number` | Current simulation tick |
| `alive` | `number` | Number of living agents |
| `uptime` | `number` | Seconds since server start |

**Example:**

```bash
curl http://localhost:3001/api/health
```

---

### `GET /api/state`

Returns a full JSON snapshot of the current colony state. This is a point-in-time snapshot captured between ticks.

**Response structure:**

```json
{
  "tick": 142,
  "cycle": 2,
  "alive": 28,
  "moneySupply": 412.7,
  "gini": 0.31,
  "gdp": 38.4,
  "agents": [ ... ],
  "markets": { ... },
  "openJobs": 12,
  "activeDebts": 4,
  "structures": ["Monopoly: agent-0017 controls 52% of memory"]
}
```

**`agents[]` — each entry:**

```json
{
  "id": "agent-0017",
  "wallet": 89.4,
  "resources": {
    "compute": 3.0,
    "memory": 47.0,
    "inference": 0.0
  },
  "debts": [],
  "tier": 1,
  "disposition": {
    "riskTolerance": 0.72,
    "acquisitiveness": 0.88,
    "creditAppetite": 0.41
  },
  "age": 142,
  "alive": true,
  "deathCountdown": 5
}
```

**`markets{}` — each resource:**

```json
{
  "compute": {
    "price": 1.24,
    "history": [1.18, 1.20, 1.22, 1.24],
    "bidCount": 8,
    "askCount": 3
  },
  "memory": {
    "price": 4.10,
    "history": [3.95, 4.00, 4.05, 4.10],
    "bidCount": 5,
    "askCount": 2
  },
  "inference": {
    "price": 2.80,
    "history": [2.75, 2.78, 2.80, 2.80],
    "bidCount": 2,
    "askCount": 4
  }
}
```

**Example:**

```bash
curl http://localhost:3001/api/state | python3 -m json.tool
```

**JavaScript example:**

```javascript
const state = await fetch('http://localhost:3001/api/state').then(r => r.json());
console.log(`Alive: ${state.alive}, Gini: ${state.gini.toFixed(2)}`);
console.log(`Top agent: ${state.agents.sort((a,b) => b.wallet - a.wallet)[0].id}`);
```

---

### `GET /api/events`

Server-Sent Events stream. Sends all engine events in real-time plus a synthetic `__tick__` event once per tick.

**Response headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Stream format:**

```
data: {"type":"job_completed","tick":142,"payload":{"id":"job-0492","agent":"agent-0017","reward":4.8}}\n\n
data: {"type":"resource_traded","tick":142,"payload":{"resource":"memory","qty":3,"price":4.10,"buyer":"agent-0005","seller":"agent-0012"}}\n\n
data: {"type":"__tick__","tick":143,"cycle":2,"alive":28,"gini":0.31,"gdp":38.4,"moneySupply":412.7,"debts":4,"prices":{"compute":1.24,"memory":4.10,"inference":2.80}}\n\n
```

### Event type reference

#### Engine events (emitted by the simulation)

| Event type | Payload fields | Description |
|---|---|---|
| `life_tax` | `agent, amount` | An agent was charged its survival tax |
| `job_offered` | `id, reward, computeCost, ttl` | New job posted to the market |
| `job_completed` | `id, agent, reward` | A worker claimed a job and received α |
| `job_expired` | `id` | An unclaimed job was removed (TTL expired) |
| `resource_traded` | `resource, qty, price, buyer, seller` | A resource order was matched |
| `price_updated` | `resource, oldPrice, newPrice` | Market price moved |
| `loan_issued` | `debtId, borrower, amount, rate` | New loan created |
| `loan_repaid` | `debtId, agent, amount, remaining` | Partial or full debt repayment |
| `loan_defaulted` | `debtId, agent, amount` | Agent died with outstanding debt |
| `agent_died` | `agent, cause` | Agent's deathCountdown reached zero |
| `shock` | `magnitude, affectedResources` | Periodic supply disruption |
| `cycle_snapshot` | `cycle, metrics, structures` | End-of-cycle aggregate snapshot |

#### Synthetic events (added by the API server)

| Event type | Description |
|---|---|
| `__tick__` | Emitted once per tick with current colony metrics. Always present even in quiet ticks. |

### `__tick__` event schema

```typescript
{
  type: "__tick__";
  tick: number;
  cycle: number;
  alive: number;
  gini: number;
  gdp: number;             // α earned this tick
  moneySupply: number;     // Σ wallet for all alive agents
  debts: number;           // count of active debts
  prices: {
    compute: number;
    memory: number;
    inference: number;
  };
  structures: string[];    // detected emergent structures this cycle
}
```

### `cycle_snapshot` event schema

```typescript
{
  type: "cycle_snapshot";
  tick: number;
  payload: {
    cycle: number;
    metrics: {
      aliveAgents: number;
      moneySupply: number;
      gini: number;
      gdpPerCycle: number;
      avgDebt: number;
      bankruptcies: number;
      jobsCompleted: number;
      jobsExpired: number;
    };
    structures: string[];  // e.g. ["Monopoly: agent-0017 controls 52% of memory"]
    chronicle: string | null;  // Fable-5 narration (Phase 4+ only)
  };
}
```

---

## SSE Client Examples

### Browser (EventSource)

```javascript
const es = new EventSource('http://localhost:3001/api/events');

es.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === '__tick__') {
    document.getElementById('alive').textContent = data.alive;
    document.getElementById('gini').textContent = data.gini.toFixed(3);
    document.getElementById('gdp').textContent = data.gdp.toFixed(1);
  }

  if (data.type === 'agent_died') {
    console.warn(`💀 ${data.payload.agent} has died`);
  }

  if (data.type === 'cycle_snapshot') {
    const { structures } = data.payload;
    if (structures.length > 0) {
      console.log('Emergent structures:', structures.join('; '));
    }
  }
};

es.onerror = () => {
  console.log('SSE disconnected — will retry');
};
```

### Node.js client

```javascript
import { EventSource } from 'eventsource';  // npm i eventsource

const es = new EventSource('http://localhost:3001/api/events');

es.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.type === '__tick__') {
    process.stdout.write(`\rTick ${data.tick} | Alive: ${data.alive} | Gini: ${data.gini.toFixed(3)}`);
  }
});
```

### Python client

```python
import json
import sseclient  # pip install sseclient-py requests

import requests

url = 'http://localhost:3001/api/events'
response = requests.get(url, stream=True)
client = sseclient.SSEClient(response)

for event in client.events():
    data = json.loads(event.data)
    if data['type'] == '__tick__':
        print(f"Tick {data['tick']} | Alive: {data['alive']} | Gini: {data['gini']:.3f}")
    elif data['type'] == 'agent_died':
        print(f"💀 {data['payload']['agent']} died")
```

### curl (raw stream)

```bash
# Stream all events (press Ctrl-C to stop)
curl -N http://localhost:3001/api/events

# Stream and pretty-print tick events only
curl -N http://localhost:3001/api/events | \
  grep '"__tick__"' | \
  python3 -c "
import sys, json
for line in sys.stdin:
    if line.startswith('data:'):
        d = json.loads(line[5:])
        if d['type'] == '__tick__':
            print(f\"T{d['tick']:04d} alive={d['alive']:3d} gini={d['gini']:.3f} gdp={d['gdp']:.1f}α\")
"
```

---

## Filtering the Event Stream

The server currently sends all events to all subscribers. If you only need specific events, filter client-side:

```javascript
const INTERESTING = new Set(['agent_died', 'loan_defaulted', 'cycle_snapshot', 'shock']);

es.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (!INTERESTING.has(data.type) && data.type !== '__tick__') return;
  // handle event
};
```

A future version will support query parameters for server-side filtering:
```
GET /api/events?filter=agent_died,cycle_snapshot
```

---

## Rate Limits and Connection Management

- No rate limits currently
- The server uses a `Set<Response>` for SSE subscribers; disconnected clients are cleaned up automatically on the next write attempt
- Keep-alive pings are sent every 20 seconds to prevent proxy timeouts
- Reconnection is handled by the `EventSource` browser API automatically (default: 3 second retry)

---

## Embedding the Visualization

The full `viz.html` visualization is self-contained. You can embed it in an iframe:

```html
<iframe
  src="http://localhost:3001/viz.html"
  width="1200"
  height="800"
  frameborder="0"
></iframe>
```

Or load it directly: `http://localhost:3001/viz.html`

---

## Extending the API

To add a new endpoint, edit `api/server.ts`:

```typescript
// Example: expose event history for the last N ticks
app.get("/api/events/history", (_req, res) => {
  const history = recentEvents.slice(-200);  // maintain a ring buffer
  res.json({ events: history });
});

// Example: trigger a manual shock
app.post("/api/admin/shock", (_req, res) => {
  engine.triggerShock();
  res.json({ ok: true });
});
```
