-- Schema for csh_analytics. Source of truth: docs/superpowers/specs/2026-05-02-versature-batch-pipeline-design.md
-- All CREATE statements use IF NOT EXISTS; safe to run repeatedly.

CREATE TABLE IF NOT EXISTS raw_cdr_segments (
  source_hash       VARCHAR PRIMARY KEY,
  from_call_id      VARCHAR NOT NULL,
  to_call_id        VARCHAR,
  from_id           VARCHAR,
  from_name         VARCHAR,
  from_user         VARCHAR,
  from_domain       VARCHAR,
  to_id             VARCHAR,
  to_user           VARCHAR,
  to_domain         VARCHAR,
  duration_seconds  INTEGER NOT NULL,
  start_time        TIMESTAMP NOT NULL,
  end_time          TIMESTAMP NOT NULL,
  answer_time       TIMESTAMP,
  call_date         DATE NOT NULL,
  pulled_at         TIMESTAMP NOT NULL,
  pull_run_id       VARCHAR NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raw_cdr_segments_call_date ON raw_cdr_segments(call_date);
CREATE INDEX IF NOT EXISTS idx_raw_cdr_segments_from_call_id ON raw_cdr_segments(from_call_id);

COMMENT ON COLUMN raw_cdr_segments.source_hash IS
  'sha256(from_call_id || coalesce(to_call_id,'''') || start_time::VARCHAR). SENSITIVE TO PAYLOAD-SHAPE CHANGES.';

CREATE TABLE IF NOT EXISTS raw_queue_stats (
  queue_id           VARCHAR NOT NULL,
  business_date      DATE NOT NULL,
  calls_offered      INTEGER,
  abandoned_calls    INTEGER,
  abandoned_rate     DOUBLE,
  avg_talk_seconds   DOUBLE,
  avg_handle_seconds DOUBLE,
  raw_payload        JSON,
  pulled_at          TIMESTAMP NOT NULL,
  pull_run_id        VARCHAR NOT NULL,
  PRIMARY KEY (queue_id, business_date)
);

CREATE TABLE IF NOT EXISTS raw_queue_splits (
  queue_id       VARCHAR NOT NULL,
  period         VARCHAR NOT NULL,
  bucket_start   TIMESTAMP NOT NULL,
  raw_payload    JSON NOT NULL,
  pulled_at      TIMESTAMP NOT NULL,
  pull_run_id    VARCHAR NOT NULL,
  PRIMARY KEY (queue_id, period, bucket_start)
);

CREATE TABLE IF NOT EXISTS logical_calls (
  from_call_id            VARCHAR PRIMARY KEY,
  call_date               DATE NOT NULL,
  caller_id               VARCHAR,
  start_time              TIMESTAMP NOT NULL,
  end_time                TIMESTAMP NOT NULL,
  total_duration_seconds  INTEGER NOT NULL,
  segment_count           INTEGER NOT NULL,
  touched_dnis            BOOLEAN NOT NULL,
  touched_queues          VARCHAR[],
  first_tracked_queue     VARCHAR,
  touched_ai              BOOLEAN NOT NULL,
  is_english              BOOLEAN NOT NULL,
  is_french               BOOLEAN NOT NULL,
  is_ai                   BOOLEAN NOT NULL,
  is_ai_overflow          BOOLEAN NOT NULL,
  rebuilt_at              TIMESTAMP NOT NULL,
  pull_run_id             VARCHAR NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logical_calls_call_date ON logical_calls(call_date);

CREATE TABLE IF NOT EXISTS kpi_snapshots (
  period               VARCHAR NOT NULL,
  period_start         DATE NOT NULL,
  period_end           DATE NOT NULL,
  include_weekends     BOOLEAN NOT NULL,

  total_incoming       INTEGER NOT NULL,
  english_calls        INTEGER NOT NULL,
  french_calls         INTEGER NOT NULL,
  ai_calls             INTEGER NOT NULL,
  ai_overflow_calls    INTEGER NOT NULL,

  total_queue_activity JSON NOT NULL,

  is_finalized         BOOLEAN NOT NULL,
  computed_at          TIMESTAMP NOT NULL,
  pull_run_id          VARCHAR NOT NULL,
  PRIMARY KEY (period, period_start, include_weekends)
);

CREATE TABLE IF NOT EXISTS pull_runs (
  pull_run_id         VARCHAR PRIMARY KEY,              -- ULID
  triggered_by        VARCHAR NOT NULL,                 -- 'cron' | 'cron-month-rollover' | 'admin' | 'manual'
  triggered_at        TIMESTAMP NOT NULL,
  finished_at         TIMESTAMP,
  status              VARCHAR NOT NULL,                 -- 'running' | 'success' | 'partial_fetch' | 'partial_build' | 'failed'
  window_start        DATE NOT NULL,
  window_end          DATE NOT NULL,
  cdr_segments_count  INTEGER,
  queue_stats_count   INTEGER,
  splits_count        INTEGER,
  logical_calls_built INTEGER,
  snapshots_built     INTEGER,
  error_summary       VARCHAR,
  finalized_month     VARCHAR
);
