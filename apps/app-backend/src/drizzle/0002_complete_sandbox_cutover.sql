ALTER TABLE "sandbox_script" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "sandbox_script" ALTER COLUMN "compiled_code" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "sandbox_script" ALTER COLUMN "compiled_format" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "sandbox_script" DROP COLUMN "code";