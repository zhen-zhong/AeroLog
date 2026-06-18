-- P0 sustainability: project signature policy, schema issue aggregation, and debug retention targets.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS require_signature BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_debug_events_result_created
    ON debug_events(result, created_at DESC);

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
