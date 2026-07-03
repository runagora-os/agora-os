import express from "express";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Engine } from "../engine/engine.js";
import { configForPhase } from "../engine/config.js";
import { detectStructures } from "../engine/detectors.js";
import { dispatchChronicle } from "../chronicler/index.js";
import type { EngineEvent } from "../engine/types.js";

// Strategy presets — translate UI preset name to disposition values
const PRESETS: Record<string, { thrift: number; acquisitiveness: number; creditAppetite: number; tier: 0 | 1 }> = {
  worker:     { thrift: 0.6,  acquisitiveness: 0.35, creditAppetite: 0.15, tier: 0 },
  investor:   { thrift: 0.25, acquisitiveness: 0.85, creditAppetite: 0.50, tier: 0 },
  miser:      { thrift: 0.92, acquisitiveness: 0.05, creditAppetite: 0.02, tier: 0 },
  risk_taker: { thrift: 0.1,  acquisitiveness: 0.60, creditAppetite: 0.90, tier: 0 },
  strategist: { thrift: 0.35, acquisitiveness: 0.70, creditAppetite: 0.50, tier: 1 },
};

const __dir = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT ?? "3001");
const TICK_MS = parseInt(process.env.TICK_MS ?? "800"); // watchable speed

// ── CORS (allow the static web files)
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Cache-Control");
  next();
});

// ── Body parsing (for POST /api/agents/spawn)
app.use(express.json());

// ── Serve web/ as static
app.use(express.static(join(__dir, "..", "web")));

// ── Boot simulation
const config = configForPhase(3, {
  seed: process.env.SIM_SEED ?? "agora-genesis",
});
const engine = new Engine(config);

// ── SSE subscribers
const subscribers = new Set<express.Response>();

// Per-cycle state for the Chronicler
let cycleGdp        = 0;
let cycleBankruptcies = 0;
let cycleEvents: EngineEvent[] = [];
let prevGini  = 0;
let prevAlive = 0;

engine.onEvent((ev: EngineEvent) => {
  // Accumulate per-cycle stats
  if (ev.type === "job_completed") cycleGdp += (ev.data.reward as number) ?? 0;
  if (ev.type === "bankruptcy")    cycleBankruptcies += 1;
  cycleEvents.push(ev);

  // On cycle boundary — call Chronicler, then reset accumulators
  if (ev.type === "cycle_snapshot") {
    const alive  = [...engine.state.agents.values()].filter(a => a.alive);
    const money  = alive.reduce((s, a) => s + a.wallet, 0);
    const wallets = alive.map(a => a.wallet).sort((a, b) => a - b);
    const n = wallets.length || 1;
    const tot = wallets.reduce((s, v) => s + v, 0) || 1;
    let cum = 0;
    for (let i = 0; i < n; i++) cum += (2*(i+1)-n-1)*wallets[i]!;
    const gini = cum / (n * tot);
    let debt = 0;
    for (const d of engine.state.debts.values()) debt += d.outstanding;

    const topAgents = alive
      .sort((a, b) => b.wallet - a.wallet)
      .slice(0, 10)
      .map(a => ({ id: a.id, name: a.name, wallet: a.wallet, memory: a.resources.memory, tier: a.disposition.tier }));

    const rawStructures = detectStructures(engine.state, { count: cycleBankruptcies, loss: 0 }, cycleBankruptcies);
    const structures = rawStructures.map(s => `${s.kind}: ${JSON.stringify(s.detail)}`);

    dispatchChronicle({
      cycle: engine.state.cycle,
      tick:  engine.state.tick,
      aliveAgents: alive.length,
      moneySupply: money,
      gini,
      gdpThisCycle: cycleGdp,
      bankruptciesThisCycle: cycleBankruptcies,
      debtOutstanding: debt,
      prices: {
        compute:   engine.state.markets.compute.price,
        memory:    engine.state.markets.memory.price,
        inference: engine.state.markets.inference.price,
      },
      structures,
      topAgents,
      recentEvents: cycleEvents.slice(-60),
      prevGini,
      prevAlive,
    }).catch(err => console.error("[chronicler]", err));

    prevGini  = gini;
    prevAlive = alive.length;
    cycleGdp  = 0;
    cycleBankruptcies = 0;
    cycleEvents = [];
  }

  // Broadcast to SSE clients
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of subscribers) {
    try { res.write(data); } catch { subscribers.delete(res); }
  }
});

// Broadcast tick metrics every tick so the viz can update stats
setInterval(() => {
  const alive = [...engine.state.agents.values()].filter(a => a.alive);
  const money = alive.reduce((s, a) => s + a.wallet, 0);

  let debtTotal = 0;
  for (const d of engine.state.debts.values()) debtTotal += d.outstanding;

  const wallets = alive.map(a => a.wallet);
  const sorted  = [...wallets].sort((a, b) => a - b);
  const n = sorted.length || 1;
  const total = sorted.reduce((s, v) => s + v, 0) || 1;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (2*(i+1)-n-1)*sorted[i]!;
  const giniVal = cum / (n * total);

  const structures = detectStructures(engine.state, { count: 0, loss: 0 }, 0);
  const tickData = `data: ${JSON.stringify({
    type: "__tick__",
    tick: engine.state.tick,
    cycle: engine.state.cycle,
    aliveAgents: alive.length,
    moneySupply: money,
    debtOutstanding: debtTotal,
    gini: giniVal,
    prices: {
      compute:   engine.state.markets.compute.price,
      memory:    engine.state.markets.memory.price,
      inference: engine.state.markets.inference.price,
    },
    structures,
    agents: alive.map(a => ({
      id: a.id,
      name: a.name,
      wallet: a.wallet,
      memory: a.resources.memory,
      compute: a.resources.compute,
      inference: a.resources.inference,
      age: a.age,
      deathCountdown: a.deathCountdown,
      tier: a.disposition.tier,
      debts: a.debts.reduce((s, d) => s + d.outstanding, 0),
    })),
    debts: [...engine.state.debts.values()].map(d => ({
      creditor: d.creditor, debtor: d.debtor, outstanding: d.outstanding,
    })),
  })}\n\n`;

  for (const res of subscribers) {
    try { res.write(tickData); } catch { subscribers.delete(res); }
  }

  engine.step();
}, TICK_MS);

// ── Routes

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, tick: engine.state.tick, cycle: engine.state.cycle });
});

app.get("/api/state", (_req, res) => {
  const alive = [...engine.state.agents.values()].filter(a => a.alive);
  res.json({
    tick: engine.state.tick,
    cycle: engine.state.cycle,
    agents: alive.map(a => ({
      id: a.id,
      wallet: a.wallet,
      memory: a.resources.memory,
      compute: a.resources.compute,
      inference: a.resources.inference,
      age: a.age,
      deathCountdown: a.deathCountdown,
      debts: a.debts.reduce((s, d) => s + d.outstanding, 0),
    })),
    prices: {
      compute:   engine.state.markets.compute.price,
      memory:    engine.state.markets.memory.price,
      inference: engine.state.markets.inference.price,
    },
    debts: [...engine.state.debts.values()].map(d => ({
      creditor: d.creditor, debtor: d.debtor, outstanding: d.outstanding,
    })),
  });
});

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type":  "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection":    "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  subscribers.add(res);
  const ka = setInterval(() => { try { res.write(": ping\n\n"); } catch { /**/ } }, 20_000);
  req.on("close", () => { clearInterval(ka); subscribers.delete(res); });
});

// ── POST /api/agents/spawn — deploy a user-configured agent into the colony
app.post("/api/agents/spawn", (req, res) => {
  const body = req.body ?? {};

  // Validate name
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  const name = rawName.slice(0, 32) || undefined;

  // Resolve disposition: preset overrides custom sliders
  const preset = typeof body.preset === "string" ? PRESETS[body.preset] : undefined;
  const thrift         = preset?.thrift         ?? clamp01(body.thrift);
  const acquisitiveness = preset?.acquisitiveness ?? clamp01(body.acquisitiveness);
  const creditAppetite  = preset?.creditAppetite  ?? clamp01(body.creditAppetite);
  const tier: 0 | 1    = preset?.tier ?? (body.tier === 1 ? 1 : 0);

  const id = engine.spawnAgent({ name, thrift, acquisitiveness, creditAppetite, tier });
  const agent = engine.state.agents.get(id)!;

  res.json({
    ok: true,
    agentId: id,
    name: agent.name,
    wallet: +agent.wallet.toFixed(2),
    tier,
    thrift, acquisitiveness, creditAppetite,
    message: name
      ? `${name} (${id}) has entered the colony.`
      : `Agent ${id} has entered the colony.`,
  });
});

function clamp01(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? 0.5 : Math.max(0, Math.min(1, n));
}

app.listen(PORT, () => {
  console.log(`\nAGORA OS API  →  http://localhost:${PORT}`);
  console.log(`Colony viz    →  http://localhost:${PORT}/viz.html`);
  console.log(`Tick speed    →  ${TICK_MS}ms/tick\n`);
});
