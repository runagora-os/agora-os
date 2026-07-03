-- AGORA OS ledger schema.
-- Two shapes of truth:
--   1. An append-only EVENT LOG (immutable history — the source of truth, and
--      what gets anchored on-chain). Never UPDATE or DELETE rows here.
--   2. Current-state snapshot tables (derived, for fast reads by the API).

CREATE TABLE IF NOT EXISTS runs (
  id            BIGSERIAL PRIMARY KEY,
  seed          TEXT        NOT NULL,
  phase         SMALLINT    NOT NULL,
  config        JSONB       NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ
);

-- Immutable event log. seq is globally ordered within a run.
CREATE TABLE IF NOT EXISTS events (
  run_id  BIGINT      NOT NULL REFERENCES runs(id),
  seq     BIGINT      NOT NULL,
  tick    INTEGER     NOT NULL,
  cycle   INTEGER     NOT NULL,
  type    TEXT        NOT NULL,
  data    JSONB       NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE INDEX IF NOT EXISTS events_run_tick_idx ON events (run_id, tick);
CREATE INDEX IF NOT EXISTS events_run_type_idx ON events (run_id, type);

-- Per-tick aggregate metrics (for dashboard charts).
CREATE TABLE IF NOT EXISTS metrics (
  run_id             BIGINT  NOT NULL REFERENCES runs(id),
  tick               INTEGER NOT NULL,
  cycle              INTEGER NOT NULL,
  alive_agents       INTEGER NOT NULL,
  gdp                DOUBLE PRECISION NOT NULL,
  money_supply       DOUBLE PRECISION NOT NULL,
  bankruptcies       INTEGER NOT NULL,
  total_debt         DOUBLE PRECISION NOT NULL,
  gini               DOUBLE PRECISION NOT NULL,
  price_compute      DOUBLE PRECISION NOT NULL,
  price_memory       DOUBLE PRECISION NOT NULL,
  price_inference    DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (run_id, tick)
);

-- Current-state agent snapshot (upserted each cycle).
CREATE TABLE IF NOT EXISTS agent_state (
  run_id      BIGINT NOT NULL REFERENCES runs(id),
  agent_id    TEXT   NOT NULL,
  tick        INTEGER NOT NULL,
  wallet      DOUBLE PRECISION NOT NULL,
  compute     DOUBLE PRECISION NOT NULL,
  memory      DOUBLE PRECISION NOT NULL,
  inference   DOUBLE PRECISION NOT NULL,
  age         INTEGER NOT NULL,
  alive       BOOLEAN NOT NULL,
  debt_owed   DOUBLE PRECISION NOT NULL,
  role        TEXT,
  PRIMARY KEY (run_id, agent_id)
);
