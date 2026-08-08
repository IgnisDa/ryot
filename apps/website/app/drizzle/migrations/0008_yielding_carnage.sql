ALTER TABLE "customer_purchase" ADD COLUMN "payment_provider" "payment_provider";--> statement-breakpoint
ALTER TABLE "customer_purchase" ADD COLUMN "provider_price_id" text;--> statement-breakpoint
ALTER TABLE "customer_purchase" ADD COLUMN "provider_product_id" text;--> statement-breakpoint
CREATE INDEX "customer_purchase_provider_lookup_idx" ON "customer_purchase" USING btree ("payment_provider","provider_price_id","provider_product_id","cancelled_on");