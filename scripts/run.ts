import { Engine } from "../engine/engine.js";
import { configForPhase } from "../engine/config.js";
import { detectStructures } from "../engine/detectors.js";
import { LedgerWriter } from "../ledger/writer.js";
import { migrate, closePool } from "../ledger/db.js";
import type { ColonyMetrics, EngineEvent } from "../engine/types.js";

/**
 * Run the simulation headless and print a periodic summary.
 *
 * Usage:
 *   pnpm sim --phase 1 --ticks 300
 *   pnpm sim --phase 3 --ticks 600 --seed my-seed --every 60
 */

function arg(name: string, def: string): string {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}

const phase = Number(arg("phase", "1")) as 1 | 2 | 3;
const ticks = Number(arg("ticks", "300"));
const every = Number(arg("every", String(60)));
const seed = arg("seed", process.env.SIM_SEED ?? "agora-genesis");

const persist = process.argv.includes("--persist");

const config = configForPhase(phase, { seed });
const engine = new Engine(config);

let recentDefaults = { count: 0, loss: 0 };
let recentBankruptcies = 0;

let writer: LedgerWriter | null = null;
if (persist) {
  await migrate();
  writer = new LedgerWriter();
  const runId = await writer.startRun(config);
  console.log(`Persisting to Postgres (run #${runId}).`);
}

engine.onEvent((ev: EngineEvent) => {
  if (ev.type === "loan_defaulted") {
    recentDefaults.count += 1;
    recentDefaults.loss += Number(ev.data.loss ?? 0);
  }
  if (ev.type === "bankruptcy") recentBankruptcies += 1;
});

function fmt(m: ColonyMetrics): string {
  const p = m.prices;
  return (
    `t=${String(m.tick).padStart(4)} ` +
    `alive=${String(m.aliveAgents).padStart(3)} ` +
    `M=${m.moneySupply.toFixed(0).padStart(6)}α ` +
    `gdp=${m.gdp.toFixed(0).padStart(5)} ` +
    `gini=${m.gini.toFixed(2)} ` +
    `debt=${m.totalDebtOutstanding.toFixed(0).padStart(5)} ` +
    `bust=${m.bankruptciesThisTick} ` +
    `| c=${p.compute.toFixed(2)} m=${p.memory.toFixed(2)} i=${p.inference.toFixed(2)}`
  );
}

console.log(`AGORA OS — phase ${phase}, seed "${seed}", ${config.initialAgents} agents, ${ticks} ticks\n`);

let last: ColonyMetrics | null = null;
for (let t = 0; t < ticks; t++) {
  const { metrics, events } = engine.step();
  last = metrics;

  if (writer) {
    writer.recordEvents(events);
    writer.recordMetrics(metrics);
    if (metrics.tick % config.ticksPerCycle === 0) await writer.snapshotAgents(engine.state);
    await writer.maybeFlush();
  }

  if (metrics.tick % every === 0 || metrics.aliveAgents === 0) {
    const structures = detectStructures(engine.state, recentDefaults, recentBankruptcies);
    console.log(fmt(metrics));
    for (const s of structures) {
      console.log(`      ⌁ ${s.kind} (sev ${s.severity.toFixed(2)}) ${JSON.stringify(s.detail)}`);
    }
    recentDefaults = { count: 0, loss: 0 };
    recentBankruptcies = 0;
  }

  if (metrics.aliveAgents === 0) {
    console.log(`\nColony extinct at tick ${metrics.tick}.`);
    break;
  }
}

if (writer) {
  await writer.snapshotAgents(engine.state);
  await writer.endRun();
  await closePool();
}

if (last) {
  console.log(`\nFinal: cycle ${last.cycle}, ${last.aliveAgents} agents alive, money supply ${last.moneySupply.toFixed(1)}α.`);
}
