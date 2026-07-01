-- Workout Builder configuration + draft tables.
-- All new tables; nothing existing is touched. Safe to re-run (IF NOT EXISTS).

-- One row per weekday (0 = Sunday ... 6 = Saturday).
CREATE TABLE IF NOT EXISTS wb_weekly_templates (
  weekday            int PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  label              text,
  primary_muscles    text[] NOT NULL DEFAULT '{}',
  secondary_muscles  text[] NOT NULL DEFAULT '{}',
  workout_style      text,
  goals              jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- One row per round/room. room_id references the existing rooms table.
CREATE TABLE IF NOT EXISTS wb_round_config (
  room_id              int PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  station_name         text,
  station_role         text,
  preferred_equipment  text[] NOT NULL DEFAULT '{}',
  allowed_equipment    text[] NOT NULL DEFAULT '{}',
  avoid_equipment      text[] NOT NULL DEFAULT '{}',
  preferred_categories text[] NOT NULL DEFAULT '{}',
  preferred_heart_rate text,
  preferred_intensity  text,
  available_space      text,
  core_only            boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Equipment usage caps shared across the whole workout.
CREATE TABLE IF NOT EXISTS wb_equipment_limits (
  equipment    text PRIMARY KEY,
  max_stations int NOT NULL DEFAULT 99,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Singleton settings row (id is always 1).
CREATE TABLE IF NOT EXISTS wb_settings (
  id               int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  reuse_weeks      int NOT NULL DEFAULT 6,
  min_score        int NOT NULL DEFAULT 90,
  auto_regen       boolean NOT NULL DEFAULT true,
  weekly_challenge jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO wb_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Saved generated workouts (pre-publish) used for compare + history.
CREATE TABLE IF NOT EXISTS wb_drafts (
  id          serial PRIMARY KEY,
  draft_date  date NOT NULL,
  label       text,
  rounds      jsonb NOT NULL,
  score       int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wb_drafts_date_idx ON wb_drafts (draft_date DESC, created_at DESC);
