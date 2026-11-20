CREATE TABLE IF NOT EXISTS aerolog.segment_members
(
    project_id      UInt32,
    segment_id      UInt64,
    segment_version UInt32,
    distinct_id     String,
    computed_at     DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (project_id, segment_id, segment_version, computed_at, distinct_id)
TTL toDateTime(computed_at) + INTERVAL 2 HOUR DELETE;
