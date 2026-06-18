-- AeroLog metadata schema (PostgreSQL)
-- 仅存储业务元数据：项目、用户、权限、埋点定义、看板。
-- 事件明细全部存放于 ClickHouse。

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    name          VARCHAR(128) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(32)  NOT NULL DEFAULT 'member', -- admin | member
    status        SMALLINT     NOT NULL DEFAULT 1,        -- 1 active 0 disabled
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
    id            BIGSERIAL PRIMARY KEY,
    name          VARCHAR(128) NOT NULL,
    token         VARCHAR(64)  NOT NULL UNIQUE,           -- AppKey，SDK 上报凭证
    secret        VARCHAR(128) NOT NULL,                  -- HMAC 签名密钥（仅服务端使用）
    description   TEXT,
    require_signature BOOLEAN NOT NULL DEFAULT false,      -- 是否强制 SDK 请求携带 HMAC 签名
    status        SMALLINT     NOT NULL DEFAULT 1,
    created_by    BIGINT       REFERENCES users(id),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS require_signature BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS project_members (
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    role       VARCHAR(32) NOT NULL DEFAULT 'viewer',  -- owner | editor | viewer
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

-- 事件元数据：定义事件名、显示名、状态等
CREATE TABLE IF NOT EXISTS event_definitions (
    id           BIGSERIAL PRIMARY KEY,
    project_id   BIGINT      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name         VARCHAR(128) NOT NULL,                  -- $AppStart / button_click
    display_name VARCHAR(128),
    description  TEXT,
    schema_required_props JSONB NOT NULL DEFAULT '[]'::jsonb,
    schema_locked BOOLEAN    NOT NULL DEFAULT false,
    status       SMALLINT    NOT NULL DEFAULT 1,
    first_seen   TIMESTAMPTZ,
    last_seen    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, name)
);

ALTER TABLE event_definitions ADD COLUMN IF NOT EXISTS schema_required_props JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE event_definitions ADD COLUMN IF NOT EXISTS schema_locked BOOLEAN NOT NULL DEFAULT false;

-- 属性元数据：event='' 为全局默认规则，event='<eventName>' 为事件专属规则
CREATE TABLE IF NOT EXISTS property_definitions (
    id           BIGSERIAL PRIMARY KEY,
    project_id   BIGINT      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name         VARCHAR(128) NOT NULL,
    display_name VARCHAR(128),
    data_type    VARCHAR(32)  NOT NULL DEFAULT 'string', -- string|number|bool|datetime|list|object|mixed|unknown
    scope        VARCHAR(32)  NOT NULL DEFAULT 'event',  -- event|user
    event        VARCHAR(128) NOT NULL DEFAULT '',       -- '' 表示全局默认；非空表示事件专属规则
    description  TEXT,
    schema_required BOOLEAN   NOT NULL DEFAULT false,
    schema_locked   BOOLEAN   NOT NULL DEFAULT false,
    enum_values  JSONB        NOT NULL DEFAULT '[]'::jsonb,
    status       SMALLINT     NOT NULL DEFAULT 1,
    first_seen   TIMESTAMPTZ,
    last_seen    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, name, scope, event)
);

ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS status SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ;
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS schema_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS schema_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS enum_values JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS event VARCHAR(128) NOT NULL DEFAULT '';

-- 匿名 ID 与登录用户 ID 绑定关系，用于查询时把匿名行为归并到同一真实用户。
CREATE TABLE IF NOT EXISTS identity_mappings (
    id           BIGSERIAL PRIMARY KEY,
    project_id   BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    anonymous_id VARCHAR(255) NOT NULL,
    user_id      VARCHAR(255) NOT NULL,
    first_seen   TIMESTAMPTZ,
    last_seen    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (project_id, anonymous_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_identity_mappings_user
    ON identity_mappings(project_id, user_id);

CREATE INDEX IF NOT EXISTS idx_identity_mappings_anonymous
    ON identity_mappings(project_id, anonymous_id);

-- 死信队列：消费失败的事件留底
CREATE TABLE IF NOT EXISTS event_dlq (
    id          BIGSERIAL PRIMARY KEY,
    project_id  BIGINT,
    payload     JSONB     NOT NULL,
    reason      TEXT      NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SDK Debugger：保留最近消费到的 SDK 上报，用于排查 SDK 是否正常、属性是否符合 Schema。
CREATE TABLE IF NOT EXISTS debug_events (
    id           BIGSERIAL PRIMARY KEY,
    project_id   BIGINT       REFERENCES projects(id) ON DELETE CASCADE,
    event        VARCHAR(128),
    event_type   VARCHAR(32)   NOT NULL,
    distinct_id  VARCHAR(255),
    user_id      VARCHAR(255),
    anonymous_id VARCHAR(255),
    result       VARCHAR(32)   NOT NULL DEFAULT 'accepted', -- accepted|schema_warning|rejected
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

-- 看板
CREATE TABLE IF NOT EXISTS dashboards (
    id          BIGSERIAL PRIMARY KEY,
    project_id  BIGINT      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        VARCHAR(128) NOT NULL,
    layout      JSONB       NOT NULL DEFAULT '[]'::jsonb,
    created_by  BIGINT      REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 转化目标：保存核心业务路径，计算仍走 ClickHouse 实时分析。
CREATE TABLE IF NOT EXISTS conversion_goals (
    id                 BIGSERIAL PRIMARY KEY,
    project_id          BIGINT       NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name                VARCHAR(128) NOT NULL,
    description         TEXT,
    events              JSONB        NOT NULL DEFAULT '[]'::jsonb,
    window_seconds      INTEGER      NOT NULL DEFAULT 604800,
    breakdown_property  VARCHAR(128),
    status              SMALLINT     NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversion_goals_project
    ON conversion_goals(project_id, status, updated_at DESC);

-- 默认管理员（密码：aerolog123，bcrypt，请上线后立即改）
INSERT INTO users (email, name, password_hash, role)
VALUES ('admin@aerolog.local', 'admin',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        'admin')
ON CONFLICT (email) DO NOTHING;
