CREATE TABLE "facet" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"mode" text DEFAULT 'generated' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"accent_color" text,
	"description" text,
	"user_id" text,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "facet_user_slug_unique" UNIQUE("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "user_facet" (
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"facet_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_facet_user_facet_unique" UNIQUE("user_id","facet_id")
);
--> statement-breakpoint
ALTER TABLE "entity_schema" ADD COLUMN "facet_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "facet" ADD CONSTRAINT "facet_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_facet" ADD CONSTRAINT "user_facet_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_facet" ADD CONSTRAINT "user_facet_facet_id_facet_id_fk" FOREIGN KEY ("facet_id") REFERENCES "public"."facet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facet_user_id_idx" ON "facet" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_facet_user_id_idx" ON "user_facet" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_facet_facet_id_idx" ON "user_facet" USING btree ("facet_id");--> statement-breakpoint
ALTER TABLE "entity_schema" ADD CONSTRAINT "entity_schema_facet_id_facet_id_fk" FOREIGN KEY ("facet_id") REFERENCES "public"."facet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_schema_facet_id_idx" ON "entity_schema" USING btree ("facet_id");