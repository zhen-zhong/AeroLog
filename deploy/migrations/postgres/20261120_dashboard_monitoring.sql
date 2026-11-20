CREATE TABLE IF NOT EXISTS dashboard_subscriptions (
    dashboard_id BIGINT PRIMARY KEY REFERENCES dashboards(id) ON DELETE CASCADE,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    cadence VARCHAR(16) NOT NULL DEFAULT 'daily' CHECK (cadence IN ('daily','weekly')),
    send_hour SMALLINT NOT NULL DEFAULT 9 CHECK (send_hour BETWEEN 0 AND 23),
    weekday SMALLINT NOT NULL DEFAULT 1 CHECK (weekday BETWEEN 1 AND 7),
    last_period_key VARCHAR(32) NOT NULL DEFAULT '',
    last_sent_at TIMESTAMPTZ,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dashboard_alert_rules (
    id BIGSERIAL PRIMARY KEY,
    dashboard_id BIGINT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    metric VARCHAR(32) NOT NULL CHECK (metric IN ('event_count','unique_users')),
    event VARCHAR(128) NOT NULL DEFAULT '',
    operator VARCHAR(8) NOT NULL CHECK (operator IN ('gt','gte','lt','lte')),
    threshold DOUBLE PRECISION NOT NULL,
    window_minutes INTEGER NOT NULL DEFAULT 60 CHECK (window_minutes BETWEEN 5 AND 10080),
    cooldown_minutes INTEGER NOT NULL DEFAULT 360 CHECK (cooldown_minutes BETWEEN 5 AND 10080),
    enabled BOOLEAN NOT NULL DEFAULT true,
    status SMALLINT NOT NULL DEFAULT 1,
    last_state BOOLEAN NOT NULL DEFAULT false,
    last_value DOUBLE PRECISION,
    last_evaluated_at TIMESTAMPTZ,
    last_notified_at TIMESTAMPTZ,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_subscriptions_due
    ON dashboard_subscriptions(enabled, project_id, dashboard_id) WHERE enabled=true;
CREATE INDEX IF NOT EXISTS idx_dashboard_alert_rules_enabled
    ON dashboard_alert_rules(enabled, project_id, dashboard_id) WHERE status=1;
