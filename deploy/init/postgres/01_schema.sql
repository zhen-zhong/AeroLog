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
    status        SMALLINT     NOT NULL DEFAULT 1,
    created_by    BIGINT       REFERENCES users(id),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

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
    status       SMALLINT    NOT NULL DEFAULT 1,
    first_seen   TIMESTAMPTZ,
    last_seen    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, name)
);

-- 属性元数据
CREATE TABLE IF NOT EXISTS property_definitions (
    id           BIGSERIAL PRIMARY KEY,
    project_id   BIGINT      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name         VARCHAR(128) NOT NULL,
    display_name VARCHAR(128),
    data_type    VARCHAR(32)  NOT NULL DEFAULT 'string', -- string|number|bool|datetime|list|object|mixed|unknown
    scope        VARCHAR(32)  NOT NULL DEFAULT 'event',  -- event|user
    description  TEXT,
    status       SMALLINT     NOT NULL DEFAULT 1,
    first_seen   TIMESTAMPTZ,
    last_seen    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, name, scope)
);

ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS status SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ;
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
ALTER TABLE property_definitions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

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

-- 默认管理员（密码：aerolog123，bcrypt，请上线后立即改）
INSERT INTO users (email, name, password_hash, role)
VALUES ('admin@aerolog.local', 'admin',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        'admin')
ON CONFLICT (email) DO NOTHING;
