CREATE TABLE "signal" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" jsonb NOT NULL,
	"properties" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"signal_schema_id" text NOT NULL,
	"subject_entity_id" text
);
--> statement-breakpoint
CREATE TABLE "signal_recipient" (
	"user_id" text NOT NULL,
	"signal_id" text NOT NULL,
	CONSTRAINT "signal_recipient_signal_id_user_id_pk" PRIMARY KEY("signal_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "signal_schema" (
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"catalog_state" text NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"audience_policy" jsonb NOT NULL,
	"properties_schema" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_schema_user_slug_unique" UNIQUE("user_id","slug"),
	CONSTRAINT "signal_schema_catalog_state_check" CHECK ("signal_schema"."catalog_state" in ('active', 'hidden'))
);
--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_signal_schema_id_signal_schema_id_fk" FOREIGN KEY ("signal_schema_id") REFERENCES "public"."signal_schema"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_subject_entity_id_entity_id_fk" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."entity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_recipient" ADD CONSTRAINT "signal_recipient_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_recipient" ADD CONSTRAINT "signal_recipient_signal_id_signal_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_schema" ADD CONSTRAINT "signal_schema_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_actor_user_id_idx" ON "signal" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "signal_signal_schema_id_idx" ON "signal" USING btree ("signal_schema_id");--> statement-breakpoint
CREATE INDEX "signal_subject_entity_id_idx" ON "signal" USING btree ("subject_entity_id");--> statement-breakpoint
CREATE INDEX "signal_recipient_user_id_idx" ON "signal_recipient" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "signal_schema_user_id_idx" ON "signal_schema" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_schema_global_slug_unique" ON "signal_schema" USING btree ("slug") WHERE "signal_schema"."user_id" is null;