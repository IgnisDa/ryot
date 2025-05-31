import {
	bigint,
	boolean,
	date,
	pgEnum,
	pgSequence,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod";

export const productTypes = pgEnum("product_type", ["cloud", "self_hosted"]);

export const ProductTypes = z.enum(productTypes.enumValues);

export type TProductTypes = z.infer<typeof ProductTypes>;

export const planTypes = pgEnum("plan_type", [
	"free",
	"monthly",
	"yearly",
	"lifetime",
]);

export const PlanTypes = z.enum(planTypes.enumValues);

export type TPlanTypes = z.infer<typeof PlanTypes>;

export const customers = pgTable("customer", {
	renewOn: date("renew_on"),
	planType: planTypes("plan_type"),
	unkeyKeyId: text("unkey_key_id"),
	ryotUserId: text("ryot_user_id"),
	hasCancelled: boolean("has_cancelled"),
	email: text("email").notNull().unique(),
	productType: productTypes("product_type"),
	oidcIssuerId: text("oidc_issuer_id").unique(),
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	paddleCustomerId: text("paddle_customer_id").unique(),
	createdOn: timestamp("created_on", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export const ticketNumberSequence = pgSequence("ticket_number_seq", {
	startWith: 1,
	increment: 1,
});

export const contactSubmissions = pgTable("contact_submission", {
	isSpam: boolean("is_spam"),
	email: text("email").notNull(),
	message: text("message").notNull(),
	isAddressed: boolean("is_addressed"),
	id: uuid("id").defaultRandom().primaryKey(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	ticketNumber: bigint("ticket_number", { mode: "bigint" }),
});
