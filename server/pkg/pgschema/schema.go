// Package pgschema owns Postgres metadata schema bootstrap and debug retention.
package pgschema

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Ensure creates or upgrades metadata tables needed by API, collector, and consumer.
func Ensure(ctx context.Context, pg *pgxpool.Pool) error {
	if pg == nil {
		return nil
	}
	_, err := pg.Exec(ctx, schemaSQL)
	return err
}

// CleanupDebugData removes old debugger records.
func CleanupDebugData(ctx context.Context, pg *pgxpool.Pool, retentionDays int) error {
	if pg == nil || retentionDays <= 0 {
		return nil
	}
	statements := []string{
		`DELETE FROM debug_events WHERE created_at < now() - make_interval(days => $1)`,
		`DELETE FROM schema_issues WHERE created_at < now() - make_interval(days => $1)`,
		`DELETE FROM schema_issue_groups WHERE updated_at < now() - make_interval(days => $1)`,
	}
	for _, stmt := range statements {
		if _, err := pg.Exec(ctx, stmt, retentionDays); err != nil {
			return err
		}
	}
	return nil
}

// StartRetentionLoop periodically applies debug data retention.
func StartRetentionLoop(ctx context.Context, pg *pgxpool.Pool, retentionDays int) {
	if pg == nil || retentionDays <= 0 {
		return
	}
	go func() {
		run := func() {
			cleanupCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
			defer cancel()
			if err := CleanupDebugData(cleanupCtx, pg, retentionDays); err != nil {
				log.Printf("debug retention cleanup err: %v", err)
			}
		}
		run()
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				run()
			case <-ctx.Done():
				return
			}
		}
	}()
}

const schemaSQL = `
ALTER TABLE projects ADD COLUMN IF NOT EXISTS require_signature BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS schema_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS schema_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS enum_values JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS event VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS owner VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE event_definitions ADD COLUMN IF NOT EXISTS schema_required_props JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE event_definitions ADD COLUMN IF NOT EXISTS schema_locked BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE
    cname text;
BEGIN
    SELECT conname INTO cname
    FROM pg_constraint
    WHERE conrelid = 'property_definitions'::regclass
      AND contype = 'u'
      AND conkey @> ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid='property_definitions'::regclass AND attname='project_id'),
          (SELECT attnum FROM pg_attribute WHERE attrelid='property_definitions'::regclass AND attname='name'),
          (SELECT attnum FROM pg_attribute WHERE attrelid='property_definitions'::regclass AND attname='scope')
      ]
      AND array_length(conkey, 1) = 3
    LIMIT 1;
    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE property_definitions DROP CONSTRAINT %I', cname);
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'property_definitions'::regclass
          AND contype = 'u'
          AND conname = 'property_definitions_project_name_scope_event_key'
    ) THEN
        ALTER TABLE property_definitions
            ADD CONSTRAINT property_definitions_project_name_scope_event_key
            UNIQUE (project_id, name, scope, event);
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS debug_events (
    id           BIGSERIAL PRIMARY KEY,
    project_id   BIGINT       REFERENCES projects(id) ON DELETE CASCADE,
    event        VARCHAR(128),
    event_type   VARCHAR(32)   NOT NULL,
    distinct_id  VARCHAR(255),
    user_id      VARCHAR(255),
    anonymous_id VARCHAR(255),
    result       VARCHAR(32)   NOT NULL DEFAULT 'accepted',
    reason       TEXT,
    payload      JSONB         NOT NULL,
    received_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
ALTER TABLE debug_events ALTER COLUMN project_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_debug_events_project_created
    ON debug_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_debug_events_project_event
    ON debug_events(project_id, event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_debug_events_result_created
    ON debug_events(result, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_issues (
    id            BIGSERIAL PRIMARY KEY,
    project_id    BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event         VARCHAR(128),
    property      VARCHAR(128),
    expected_type VARCHAR(32),
    actual_type   VARCHAR(32),
    severity      VARCHAR(16)   NOT NULL DEFAULT 'warning',
    message       TEXT          NOT NULL,
    payload       JSONB         NOT NULL,
    observed_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schema_issues_project_created
    ON schema_issues(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_schema_issues_project_property
    ON schema_issues(project_id, property, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_issue_groups (
    id             BIGSERIAL PRIMARY KEY,
    project_id     BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event          VARCHAR(128) NOT NULL DEFAULT '',
    property       VARCHAR(128) NOT NULL DEFAULT '',
    expected_type  VARCHAR(32)  NOT NULL DEFAULT '',
    actual_type    VARCHAR(32)  NOT NULL DEFAULT '',
    severity       VARCHAR(16)  NOT NULL DEFAULT 'warning',
    message        TEXT         NOT NULL,
    fingerprint    VARCHAR(128) NOT NULL,
    count          BIGINT       NOT NULL DEFAULT 0,
    sample_payload JSONB        NOT NULL DEFAULT '{}'::jsonb,
    first_seen     TIMESTAMPTZ,
    last_seen      TIMESTAMPTZ,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE(project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_schema_issue_groups_project_updated
    ON schema_issue_groups(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_schema_issue_groups_project_event
    ON schema_issue_groups(project_id, event, updated_at DESC);

CREATE TABLE IF NOT EXISTS property_change_log (
    id            BIGSERIAL PRIMARY KEY,
    project_id    BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    property_name VARCHAR(128) NOT NULL,
    scope         VARCHAR(32)  NOT NULL DEFAULT 'event',
    event         VARCHAR(128) NOT NULL DEFAULT '',
    change_type   VARCHAR(32)  NOT NULL DEFAULT 'update',
    actor         VARCHAR(128) NOT NULL DEFAULT '',
    note          TEXT,
    before_value  JSONB,
    after_value   JSONB,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_property_change_log_property
    ON property_change_log(project_id, property_name, scope, event, created_at DESC);

CREATE TABLE IF NOT EXISTS conversion_goals (
    id                 BIGSERIAL PRIMARY KEY,
    project_id          BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name                VARCHAR(128) NOT NULL,
    description         TEXT,
    events              JSONB        NOT NULL DEFAULT '[]'::jsonb,
    window_seconds      INTEGER      NOT NULL DEFAULT 604800,
    breakdown_property  VARCHAR(128),
    version             INT          NOT NULL DEFAULT 1,
    status              SMALLINT     NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);
ALTER TABLE conversion_goals ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_conversion_goals_project
    ON conversion_goals(project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS conversion_goal_versions (
    id                 BIGSERIAL PRIMARY KEY,
    goal_id            BIGINT       NOT NULL REFERENCES conversion_goals(id) ON DELETE CASCADE,
    project_id          BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version            INT          NOT NULL,
    name               VARCHAR(128) NOT NULL,
    description        TEXT,
    events             JSONB        NOT NULL DEFAULT '[]'::jsonb,
    window_seconds     INTEGER      NOT NULL DEFAULT 604800,
    breakdown_property VARCHAR(128),
    note               TEXT,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE(goal_id, version)
);
CREATE INDEX IF NOT EXISTS idx_conversion_goal_versions_goal
    ON conversion_goal_versions(goal_id, version DESC);

CREATE TABLE IF NOT EXISTS query_templates (
    id          BIGSERIAL PRIMARY KEY,
    project_id  BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        VARCHAR(128) NOT NULL,
    description TEXT,
    config      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    share_token VARCHAR(96) UNIQUE,
    is_shared   BOOLEAN      NOT NULL DEFAULT false,
    status      SMALLINT     NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_query_templates_project
    ON query_templates(project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS analytics_jobs (
    id            BIGSERIAL PRIMARY KEY,
    project_id    BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type          VARCHAR(32)  NOT NULL,
    status        VARCHAR(32)  NOT NULL DEFAULT 'pending',
    input         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    result        JSONB,
    error_message TEXT,
    rows_count    BIGINT       NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_analytics_jobs_project
    ON analytics_jobs(project_id, status, created_at DESC);
`
