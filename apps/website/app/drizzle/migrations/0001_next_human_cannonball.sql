CREATE TABLE IF NOT EXISTS "contact_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"message" text NOT NULL,
	"is_spam" boolean,
	"is_addressed" boolean
);
