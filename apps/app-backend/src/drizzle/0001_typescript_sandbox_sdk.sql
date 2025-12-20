ALTER TABLE "sandbox_script" ADD COLUMN "source" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sandbox_script" ADD COLUMN "compiled_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sandbox_script" ADD COLUMN "compiled_format" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "sandbox_script" SET "source" = "code";
