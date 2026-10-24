ALTER TABLE "relationship_projection_work" ADD COLUMN "input_repair_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship_projection_work" ADD COLUMN "prepared_input_repair_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "relationship_projection_work" SET "input_repair_revision" = 1;
