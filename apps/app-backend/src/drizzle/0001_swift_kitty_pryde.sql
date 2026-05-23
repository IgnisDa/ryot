ALTER TABLE "event_schema_trigger" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "event_schema_trigger" ALTER COLUMN "metadata" DROP DEFAULT;
