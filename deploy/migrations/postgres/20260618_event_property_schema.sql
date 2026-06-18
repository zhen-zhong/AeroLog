-- 事件级 Schema 隔离：同名参数按事件配置类型、枚举和必填规则
-- 兼容策略：event='' 表示全局默认规则，event='<eventName>' 表示该事件专属规则

ALTER TABLE property_definitions
    ADD COLUMN IF NOT EXISTS event VARCHAR(128) NOT NULL DEFAULT '';

DO $$
DECLARE
    cname text;
BEGIN
    SELECT conname INTO cname
    FROM pg_constraint
    WHERE conrelid = 'property_definitions'::regclass
      AND contype = 'u'
      AND conkey @> ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid='property_definitions'::regclass AND attname='project_id'),
          (SELECT attnum FROM pg_attribute WHERE attrelid='property_definitions'::regclass AND attname='name'),
          (SELECT attnum FROM pg_attribute WHERE attrelid='property_definitions'::regclass AND attname='scope')
      ]
      AND array_length(conkey, 1) = 3
    LIMIT 1;

    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE property_definitions DROP CONSTRAINT %I', cname);
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'property_definitions'::regclass
          AND contype = 'u'
          AND conname = 'property_definitions_project_name_scope_event_key'
    ) THEN
        ALTER TABLE property_definitions
            ADD CONSTRAINT property_definitions_project_name_scope_event_key
            UNIQUE (project_id, name, scope, event);
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_property_definitions_event
    ON property_definitions(project_id, scope, event, name);
