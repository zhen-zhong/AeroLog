-- AeroLog ClickHouse schema
-- 事件明细表，按 project_id + 月份分区，TTL 365 天

CREATE DATABASE IF NOT EXISTS aerolog;

CREATE TABLE IF NOT EXISTS aerolog.events
(
    project_id    UInt32,
    event         LowCardinality(String),
    distinct_id   String,
    user_id       String DEFAULT '',
    anonymous_id  String DEFAULT '',
    time          DateTime64(3, 'UTC'),
    date          Date DEFAULT toDate(time),
    -- 上下文（高频维度抽列，便于查询）
    lib           LowCardinality(String) DEFAULT '',     -- web|android|ios|server
    lib_version   LowCardinality(String) DEFAULT '',
    os            LowCardinality(String) DEFAULT '',
    os_version    LowCardinality(String) DEFAULT '',
    device_model  LowCardinality(String) DEFAULT '',
    app_version   LowCardinality(String) DEFAULT '',
    network       LowCardinality(String) DEFAULT '',
    screen_w      UInt16 DEFAULT 0,
    screen_h      UInt16 DEFAULT 0,
    -- 地理（IP 富化）
    ip            IPv4 DEFAULT toIPv4('0.0.0.0'),
    country       LowCardinality(String) DEFAULT '',
    province      LowCardinality(String) DEFAULT '',
    city          LowCardinality(String) DEFAULT '',
    -- UA 富化
    browser       LowCardinality(String) DEFAULT '',
    browser_ver   LowCardinality(String) DEFAULT '',
    -- 业务自定义属性，原始 JSON
    properties    String DEFAULT '{}',
    -- 接收时间
    received_at   DateTime DEFAULT now()
)
ENGINE = MergeTree
PARTITION BY (project_id, toYYYYMM(date))
ORDER BY (project_id, event, time, distinct_id)
TTL date + INTERVAL 365 DAY
SETTINGS index_granularity = 8192;

-- Buffer 引擎：让 Consumer 可低延迟批量写入；后台自动 flush 到 events
CREATE TABLE IF NOT EXISTS aerolog.events_buffer AS aerolog.events
ENGINE = Buffer(aerolog, events, 16,
                10, 60,        -- min/max flush 时间秒
                10000, 100000, -- min/max 行数
                10000000, 100000000); -- min/max 字节

-- 用户属性表（profile_set），最新值覆盖
CREATE TABLE IF NOT EXISTS aerolog.users
(
    project_id   UInt32,
    distinct_id  String,
    properties   String DEFAULT '{}',
    updated_at   DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (project_id, distinct_id);
