ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS cached_users BIGINT;
ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS cached_at TIMESTAMPTZ;
ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS cache_expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_segment_versions (
    id          BIGSERIAL PRIMARY KEY,
    segment_id  BIGINT       NOT NULL REFERENCES user_segments(id) ON DELETE CASCADE,
    project_id  BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version     INTEGER      NOT NULL,
    name        VARCHAR(128) NOT NULL,
    description TEXT         NOT NULL DEFAULT '',
    rules       JSONB        NOT NULL,
    created_by  BIGINT       REFERENCES users(id),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE(segment_id, version)
);

INSERT INTO user_segment_versions(segment_id, project_id, version, name, description, rules, created_by, created_at)
SELECT id, project_id, version, name, description, rules, created_by, created_at
FROM user_segments
ON CONFLICT(segment_id, version) DO NOTHING;
