ALTER TABLE aerolog.users
    ADD COLUMN IF NOT EXISTS user_id String DEFAULT '';

ALTER TABLE aerolog.users
    ADD COLUMN IF NOT EXISTS anonymous_id String DEFAULT '';
