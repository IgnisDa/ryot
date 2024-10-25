import {
	boolean,
	date,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod";

export const productTypes = pgEnum("product_type", ["cloud", "self_hosted"]);

export const ProductTypes = z.enum(productTypes.enumValues);

export const planTypes = pgEnum("plan_type", ["monthly", "yearly", "lifetime"]);

export const PlanTypes = z.enum(planTypes.enumValues);

export const customers = pgTable("customer", {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	email: text("email").notNull().unique(),
	createdOn: timestamp("created_on", { withTimezone: true })
		.defaultNow()
		.notNull(),
	oidcIssuerId: text("oidc_issuer_id").unique(),
	paddleCustomerId: text("paddle_customer_id").unique(),
	productType: productTypes("product_type"),
	planType: planTypes("plan_type"),
	renewOn: date("renew_on"),
	unkeyKeyId: text("unkey_key_id"),
	ryotUserId: text("ryot_user_id"),
	hasCancelled: boolean("has_cancelled"),
});

export const contactSubmissions = pgTable("contact_submission", {
	id: uuid("id").defaultRandom().primaryKey(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	email: text("email").notNull(),
	message: text("message").notNull(),
	isSpam: boolean("is_spam"),
	isAddressed: boolean("is_addressed"),
});
