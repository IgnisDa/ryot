CREATE TABLE "entity_translation" (
	"name" text,
	"description" text,
	"language" text NOT NULL,
	"image" jsonb,
	"populated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_translation_entity_language_unique" UNIQUE("entity_id","language")
);
--> statement-breakpoint
ALTER TABLE "entity_translation" ADD CONSTRAINT "entity_translation_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_translation_entity_id_idx" ON "entity_translation" USING btree ("entity_id");