import type pg from "pg";
import { getPool } from "./db.js";
import type { SimConfig } from "../engine/config.js";
import type { ColonyMetrics, ColonyState, EngineEvent } from "../engine/types.js";

/**
 * Buffered ledger writer. Events are appended to an in-memory batch and flushed
 * to Postgres in bulk (keeping the tick loop fast). The event log is
 * append-only; agent_state is upserted at cycle boundaries.
 */
export class LedgerWriter {
  private pool: pg.Pool;
  private runId!: number;
  private seq = 0;
  private eventBatch: EngineEvent[] = [];
  private metricBatch: ColonyMetrics[] = [];
  private readonly flushEvery: number;

  constructor(flushEvery = 500) {
    this.pool = getPool();
    this.flushEvery = flushEvery;
  }

  async startRun(config: SimConfig): Promise<number> {
    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO runs (seed, phase, config) VALUES ($1, $2, $3) RETURNING id`,
      [config.seed, config.phase, JSON.stringify(config)],
    );
    this.runId = Number(res.rows[0]!.id);
    return this.runId;
  }

  recordEvents(events: EngineEvent[]): void {
    for (const e of events) this.eventBatch.push(e);
  }

  recordMetrics(m: ColonyMetrics): void {
    this.metricBatch.push(m);
  }

  async maybeFlush(): Promise<void> {
    if (this.eventBatch.length >= this.flushEvery || this.metricBatch.length >= this.flushEvery) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.eventBatch.length) {
      const rows = this.eventBatch;
      const values: unknown[] = [];
      const tuples: string[] = [];
      rows.forEach((e, i) => {
        const b = i * 5;
        tuples.push(`($1, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
        values.push(this.seq++, e.tick, e.cycle, e.type, JSON.stringify(e.data));
      });
      await this.pool.query(
        `INSERT INTO events (run_id, seq, tick, cycle, type, data) VALUES ${tuples.join(",")}`,
        [this.runId, ...values],
      );
      this.eventBatch = [];
    }

    if (this.metricBatch.length) {
      const rows = this.metricBatch;
      const values: unknown[] = [];
      const tuples: string[] = [];
      rows.forEach((m, i) => {
        const b = i * 11;
        tuples.push(
          `($1, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12})`,
        );
        values.push(
          m.tick, m.cycle, m.aliveAgents, m.gdp, m.moneySupply, m.bankruptciesThisTick,
          m.totalDebtOutstanding, m.gini, m.prices.compute, m.prices.memory, m.prices.inference,
        );
      });
      await this.pool.query(
        `INSERT INTO metrics (run_id, tick, cycle, alive_agents, gdp, money_supply, bankruptcies, total_debt, gini, price_compute, price_memory, price_inference)
         VALUES ${tuples.join(",")} ON CONFLICT (run_id, tick) DO NOTHING`,
        [this.runId, ...values],
      );
      this.metricBatch = [];
    }
  }

  /** Snapshot current agent state at a cycle boundary. */
  async snapshotAgents(state: ColonyState): Promise<void> {
    const rows = [...state.agents.values()];
    if (rows.length === 0) return;
    const values: unknown[] = [];
    const tuples: string[] = [];
    rows.forEach((a, i) => {
      const b = i * 10;
      const debtOwed = a.debts.reduce((s, d) => s + d.outstanding, 0);
      tuples.push(
        `($1, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11})`,
      );
      values.push(
        a.id, state.tick, a.wallet, a.resources.compute, a.resources.memory,
        a.resources.inference, a.age, a.alive, debtOwed, a.role ?? null,
      );
    });
    await this.pool.query(
      `INSERT INTO agent_state (run_id, agent_id, tick, wallet, compute, memory, inference, age, alive, debt_owed, role)
       VALUES ${tuples.join(",")}
       ON CONFLICT (run_id, agent_id) DO UPDATE SET
         tick = EXCLUDED.tick, wallet = EXCLUDED.wallet, compute = EXCLUDED.compute,
         memory = EXCLUDED.memory, inference = EXCLUDED.inference, age = EXCLUDED.age,
         alive = EXCLUDED.alive, debt_owed = EXCLUDED.debt_owed, role = EXCLUDED.role`,
      [this.runId, ...values],
    );
  }

  async endRun(): Promise<void> {
    await this.flush();
    await this.pool.query(`UPDATE runs SET ended_at = now() WHERE id = $1`, [this.runId]);
  }
}
