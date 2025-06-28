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
	"id" text PRIMARY KEY NOT NULL,
	"refill_amount" integer,
	"last_request" timestamp,
	"refill_interval" integer,
	"last_refill_at" timestamp,
	"reference_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"enabled" boolean DEFAULT true,
	"request_count" integer DEFAULT 0,
	"rate_limit_max" integer DEFAULT 10,
	"rate_limit_enabled" boolean DEFAULT true,
	"config_id" text DEFAULT 'default' NOT NULL,
	"rate_limit_time_window" integer DEFAULT 86400000
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"external_id" text,
	"name" text NOT NULL,
	"image" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" text,
	"entity_schema_id" text NOT NULL,
	"sandbox_script_id" text,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entity_user_schema_script_external_id_unique" UNIQUE("user_id","external_id","entity_schema_id","sandbox_script_id")
);
--> statement-breakpoint
CREATE TABLE "entity_schema" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"accent_color" text NOT NULL,
	"properties_schema" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entity_schema_user_slug_unique" UNIQUE("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "entity_schema_script" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_schema_id" text NOT NULL,
	"sandbox_script_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entity_schema_script_unique" UNIQUE("entity_schema_id","sandbox_script_id")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"session_entity_id" text,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"event_schema_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_schema" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"properties_schema" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"entity_schema_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_schema_user_entity_schema_slug_unique" UNIQUE("user_id","entity_schema_id","slug")
);
--> statement-breakpoint
CREATE TABLE "relationship" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" text,
	"source_entity_id" text NOT NULL,
	"target_entity_id" text NOT NULL,
	"relationship_schema_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	CONSTRAINT "relationship_user_source_target_schema_unique" UNIQUE("user_id","source_entity_id","target_entity_id","relationship_schema_id")
);
--> statement-breakpoint
CREATE TABLE "relationship_schema" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"properties_schema" jsonb NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"source_entity_schema_id" text,
	"target_entity_schema_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "relationship_schema_user_slug_unique" UNIQUE("user_id","slug")
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
	"icon" text NOT NULL,
	"accent_color" text NOT NULL,
	"query_definition" jsonb NOT NULL,
	"display_configuration" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"tracker_id" text,
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
CREATE TABLE "tracker" (
	"description" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"accent_color" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tracker_user_slug_unique" UNIQUE("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "tracker_entity_schema" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"tracker_id" text NOT NULL,
	"entity_schema_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tracker_entity_schema_unique" UNIQUE("tracker_id","entity_schema_id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"image" text,
	"name" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
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
ALTER TABLE "entity" ADD CONSTRAINT "entity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_entity_schema_id_entity_schema_id_fk" FOREIGN KEY ("entity_schema_id") REFERENCES "public"."entity_schema"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_sandbox_script_id_sandbox_script_id_fk" FOREIGN KEY ("sandbox_script_id") REFERENCES "public"."sandbox_script"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_schema" ADD CONSTRAINT "entity_schema_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_schema_script" ADD CONSTRAINT "entity_schema_script_entity_schema_id_entity_schema_id_fk" FOREIGN KEY ("entity_schema_id") REFERENCES "public"."entity_schema"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_schema_script" ADD CONSTRAINT "entity_schema_script_sandbox_script_id_sandbox_script_id_fk" FOREIGN KEY ("sandbox_script_id") REFERENCES "public"."sandbox_script"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_session_entity_id_entity_id_fk" FOREIGN KEY ("session_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_event_schema_id_event_schema_id_fk" FOREIGN KEY ("event_schema_id") REFERENCES "public"."event_schema"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_schema" ADD CONSTRAINT "event_schema_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_schema" ADD CONSTRAINT "event_schema_entity_schema_id_entity_schema_id_fk" FOREIGN KEY ("entity_schema_id") REFERENCES "public"."entity_schema"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_source_entity_id_entity_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_target_entity_id_entity_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_relationship_schema_id_relationship_schema_id_fk" FOREIGN KEY ("relationship_schema_id") REFERENCES "public"."relationship_schema"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_schema" ADD CONSTRAINT "relationship_schema_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_schema" ADD CONSTRAINT "relationship_schema_source_entity_schema_id_entity_schema_id_fk" FOREIGN KEY ("source_entity_schema_id") REFERENCES "public"."entity_schema"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_schema" ADD CONSTRAINT "relationship_schema_target_entity_schema_id_entity_schema_id_fk" FOREIGN KEY ("target_entity_schema_id") REFERENCES "public"."entity_schema"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_script" ADD CONSTRAINT "sandbox_script_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_tracker_id_tracker_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."tracker"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker" ADD CONSTRAINT "tracker_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_entity_schema" ADD CONSTRAINT "tracker_entity_schema_tracker_id_tracker_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."tracker"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_entity_schema" ADD CONSTRAINT "tracker_entity_schema_entity_schema_id_entity_schema_id_fk" FOREIGN KEY ("entity_schema_id") REFERENCES "public"."entity_schema"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "entity_user_id_idx" ON "entity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entity_external_id_idx" ON "entity" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "entity_entity_schema_id_idx" ON "entity" USING btree ("entity_schema_id");--> statement-breakpoint
CREATE INDEX "entity_properties_idx" ON "entity" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "entity_sandbox_script_id_idx" ON "entity" USING btree ("sandbox_script_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_global_external_id_unique" ON "entity" USING btree ("external_id","entity_schema_id","sandbox_script_id") WHERE "entity"."user_id" is null;--> statement-breakpoint
CREATE INDEX "entity_schema_user_id_idx" ON "entity_schema" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entity_schema_script_entity_schema_id_idx" ON "entity_schema_script" USING btree ("entity_schema_id");--> statement-breakpoint
CREATE INDEX "entity_schema_script_sandbox_script_id_idx" ON "entity_schema_script" USING btree ("sandbox_script_id");--> statement-breakpoint
CREATE INDEX "event_user_id_idx" ON "event" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "event_entity_id_idx" ON "event" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "event_event_schema_id_idx" ON "event" USING btree ("event_schema_id");--> statement-breakpoint
CREATE INDEX "event_session_entity_id_idx" ON "event" USING btree ("session_entity_id");--> statement-breakpoint
CREATE INDEX "event_properties_idx" ON "event" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "event_schema_entity_schema_id_idx" ON "event_schema" USING btree ("entity_schema_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_schema_builtin_entity_schema_slug_unique" ON "event_schema" USING btree ("entity_schema_id","slug") WHERE "event_schema"."user_id" is null;--> statement-breakpoint
CREATE INDEX "relationship_schema_id_idx" ON "relationship" USING btree ("relationship_schema_id");--> statement-breakpoint
CREATE INDEX "relationship_source_entity_id_idx" ON "relationship" USING btree ("source_entity_id");--> statement-breakpoint
CREATE INDEX "relationship_target_entity_id_idx" ON "relationship" USING btree ("target_entity_id");--> statement-breakpoint
CREATE INDEX "relationship_properties_idx" ON "relationship" USING gin ("properties");--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_global_source_target_schema_unique" ON "relationship" USING btree ("source_entity_id","target_entity_id","relationship_schema_id") WHERE "relationship"."user_id" is null;--> statement-breakpoint
CREATE INDEX "relationship_schema_user_id_idx" ON "relationship_schema" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "relationship_schema_source_entity_schema_id_idx" ON "relationship_schema" USING btree ("source_entity_schema_id");--> statement-breakpoint
CREATE INDEX "relationship_schema_target_entity_schema_id_idx" ON "relationship_schema" USING btree ("target_entity_schema_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_schema_builtin_slug_unique" ON "relationship_schema" USING btree ("slug") WHERE "relationship_schema"."user_id" is null;--> statement-breakpoint
CREATE INDEX "sandbox_script_user_id_idx" ON "sandbox_script" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_view_user_id_idx" ON "saved_view" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_view_tracker_id_idx" ON "saved_view" USING btree ("tracker_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tracker_user_id_idx" ON "tracker" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tracker_entity_schema_tracker_id_idx" ON "tracker_entity_schema" USING btree ("tracker_id");--> statement-breakpoint
CREATE INDEX "tracker_entity_schema_entity_schema_id_idx" ON "tracker_entity_schema" USING btree ("entity_schema_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");