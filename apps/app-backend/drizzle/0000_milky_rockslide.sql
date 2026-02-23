CREATE TABLE "account" (
	"scope" text,
	"id_token" text,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"name" text,
	"start" text,
	"prefix" text,
	"metadata" text,
	"permissions" text,
	"remaining" integer,
	"key" text NOT NULL,
	"expires_at" timestamp,
	"refill_amount" integer,
	"id" text PRIMARY KEY NOT NULL,
	"last_request" timestamp,
	"refill_interval" integer,
	"last_refill_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"enabled" boolean DEFAULT true,
	"request_count" integer DEFAULT 0,
	"rate_limit_max" integer DEFAULT 10,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"search_vector" text,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" text,
	"id" text PRIMARY KEY NOT NULL,
	"schema_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_schema" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"properties_schema" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"event_schemas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"display_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"search_sandbox_script_id" text,
	"id" text PRIMARY KEY NOT NULL,
	CONSTRAINT "entity_schema_user_slug_unique" UNIQUE("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"event_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_entity_id" text,
	"entity_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationship" (
	"rel_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" text,
	"id" text PRIMARY KEY NOT NULL,
	"source_entity_id" text NOT NULL,
	"target_entity_id" text NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "saved_view" (
	"name" text NOT NULL,
	"query_definition" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"display_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"ip_address" text,
	"user_agent" text,
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"image" text,
	"name" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"is_anonymous" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"identifier" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_schema_id_entity_schema_id_fk" FOREIGN KEY ("schema_id") REFERENCES "public"."entity_schema"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_schema" ADD CONSTRAINT "entity_schema_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_schema" ADD CONSTRAINT "entity_schema_search_sandbox_script_id_sandbox_script_id_fk" FOREIGN KEY ("search_sandbox_script_id") REFERENCES "public"."sandbox_script"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_session_entity_id_entity_id_fk" FOREIGN KEY ("session_entity_id") REFERENCES "public"."entity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_source_entity_id_entity_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_target_entity_id_entity_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_script" ADD CONSTRAINT "sandbox_script_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "apikey_userId_idx" ON "apikey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entity_user_id_idx" ON "entity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entity_schema_id_idx" ON "entity" USING btree ("schema_id");--> statement-breakpoint
CREATE INDEX "entity_properties_idx" ON "entity" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "entity_external_ids_idx" ON "entity" USING gin ("external_ids");--> statement-breakpoint
CREATE INDEX "entity_search_vector_idx" ON "entity" USING gin (to_tsvector('english', "name"));--> statement-breakpoint
CREATE INDEX "entity_schema_slug_idx" ON "entity_schema" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "entity_schema_user_id_idx" ON "entity_schema" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entity_schema_search_sandbox_script_id_idx" ON "entity_schema" USING btree ("search_sandbox_script_id");--> statement-breakpoint
CREATE INDEX "event_type_idx" ON "event" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "event_user_id_idx" ON "event" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "event_entity_id_idx" ON "event" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "event_occurred_at_idx" ON "event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "event_session_entity_id_idx" ON "event" USING btree ("session_entity_id");--> statement-breakpoint
CREATE INDEX "event_properties_idx" ON "event" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "relationship_rel_type_idx" ON "relationship" USING btree ("rel_type");--> statement-breakpoint
CREATE INDEX "relationship_source_entity_id_idx" ON "relationship" USING btree ("source_entity_id");--> statement-breakpoint
CREATE INDEX "relationship_target_entity_id_idx" ON "relationship" USING btree ("target_entity_id");--> statement-breakpoint
CREATE INDEX "relationship_properties_idx" ON "relationship" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "sandbox_script_slug_idx" ON "sandbox_script" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "sandbox_script_user_id_idx" ON "sandbox_script" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_view_user_id_idx" ON "saved_view" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");