-- SDK Debugger 全链路关联字段；原始值仍保留在 properties JSON 中。
ALTER TABLE aerolog.events ADD COLUMN IF NOT EXISTS insert_id String DEFAULT '' AFTER anonymous_id;
ALTER TABLE aerolog.events ADD COLUMN IF NOT EXISTS session_id String DEFAULT '' AFTER insert_id;
