CREATE TABLE IF NOT EXISTS event_property_relations (
    project_id   BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event        VARCHAR(128) NOT NULL,
    property     VARCHAR(128) NOT NULL,
    data_type    VARCHAR(32)  NOT NULL DEFAULT 'unknown',
    first_seen   TIMESTAMPTZ,
    last_seen    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, event, property)
);

CREATE INDEX IF NOT EXISTS idx_event_property_relations_lookup
    ON event_property_relations(project_id, event, last_seen DESC);

CREATE TABLE IF NOT EXISTS event_property_relation_backfills (
    project_id   BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event        VARCHAR(128) NOT NULL,
    completed_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, event)
);
