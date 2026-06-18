-- P1 模块基础设施：转化目标版本、查询模板、异步任务、属性治理（owner/状态/审计）。

-- 1. 转化目标版本
ALTER TABLE conversion_goals
    ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS conversion_goal_versions (
    id                 BIGSERIAL PRIMARY KEY,
    goal_id            BIGINT       NOT NULL REFERENCES conversion_goals(id) ON DELETE CASCADE,
    project_id         BIGINT       NOT NULL,
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

-- 2. 查询模板与分享
CREATE TABLE IF NOT EXISTS query_templates (
    id           BIGSERIAL PRIMARY KEY,
    project_id   BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name         VARCHAR(128) NOT NULL,
    description  TEXT,
    config       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    share_token  VARCHAR(64)  UNIQUE,
    is_shared    BOOLEAN      NOT NULL DEFAULT false,
    status       SMALLINT     NOT NULL DEFAULT 1,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_query_templates_project
    ON query_templates(project_id, status, updated_at DESC);

-- 3. 异步任务（大结果导出）
CREATE TABLE IF NOT EXISTS analytics_jobs (
    id            BIGSERIAL PRIMARY KEY,
    project_id    BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type          VARCHAR(32)  NOT NULL,                  -- query_export | conversion_export
    status        VARCHAR(16)  NOT NULL DEFAULT 'pending',-- pending|running|succeeded|failed
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

-- 4. 属性治理增强：负责人、废弃/隐藏、变更审计
ALTER TABLE property_definitions
    ADD COLUMN IF NOT EXISTS owner VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE property_definitions
    ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE property_definitions
    ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS property_change_log (
    id            BIGSERIAL PRIMARY KEY,
    project_id    BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    property_name VARCHAR(128) NOT NULL,
    scope         VARCHAR(32)  NOT NULL,
    event         VARCHAR(128) NOT NULL DEFAULT '',
    change_type   VARCHAR(32)  NOT NULL,   -- update|archive|unarchive|hide|unhide|batch
    actor         VARCHAR(128) NOT NULL DEFAULT '',
    note          TEXT,
    before_value  JSONB,
    after_value   JSONB,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_change_log_property
    ON property_change_log(project_id, property_name, scope, event, created_at DESC);
