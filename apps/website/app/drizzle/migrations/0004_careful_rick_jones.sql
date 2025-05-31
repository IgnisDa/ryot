CREATE SEQUENCE "public"."ticket_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "contact_submission" ADD COLUMN "ticket_number" bigint;--> statement-breakpoint
-- Populate ticket_number for existing non-spam submissions
UPDATE "contact_submission"
SET "ticket_number" = nextval('ticket_number_seq')
WHERE "is_spam" = false OR "is_spam" IS NULL;
