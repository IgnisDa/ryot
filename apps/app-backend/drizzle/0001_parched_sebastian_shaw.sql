CREATE TABLE "sandbox_script" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_script_user_slug_unique" UNIQUE("user_id","slug")
);
--> statement-breakpoint
ALTER TABLE "entity_schema" ADD COLUMN "search_script_id" text;--> statement-breakpoint
ALTER TABLE "sandbox_script" ADD CONSTRAINT "sandbox_script_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandbox_script_slug_idx" ON "sandbox_script" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "sandbox_script_user_id_idx" ON "sandbox_script" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "entity_schema" ADD CONSTRAINT "entity_schema_search_script_id_sandbox_script_id_fk" FOREIGN KEY ("search_script_id") REFERENCES "public"."sandbox_script"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_schema_search_script_id_idx" ON "entity_schema" USING btree ("search_script_id");