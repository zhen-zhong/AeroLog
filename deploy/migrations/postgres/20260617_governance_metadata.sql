ALTER TABLE property_definitions
    ADD COLUMN IF NOT EXISTS status SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE property_definitions
    ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ;

ALTER TABLE property_definitions
    ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;

ALTER TABLE property_definitions
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS identity_mappings (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    anonymous_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    first_seen TIMESTAMPTZ,
    last_seen TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, anonymous_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_identity_mappings_user
    ON identity_mappings(project_id, user_id);

CREATE INDEX IF NOT EXISTS idx_identity_mappings_anonymous
    ON identity_mappings(project_id, anonymous_id);
