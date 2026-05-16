CREATE TABLE "migration_report" (
	"seq" serial PRIMARY KEY,
	"count" integer,
	"phase" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"elapsed_seconds" double precision,
	CONSTRAINT "migration_report_level_check" CHECK ("level" in ('info', 'warning'))
);
