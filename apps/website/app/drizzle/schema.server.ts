import {
	bigint,
	boolean,
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

export const paymentProviders = pgEnum("payment_provider", ["paddle", "polar"]);

export const PaymentProviders = z.enum(paymentProviders.enumValues);

export type TPaymentProviders = z.infer<typeof PaymentProviders>;

export const customers = pgTable("customer", {
	unkeyKeyId: text("unkey_key_id"),
	ryotUserId: text("ryot_user_id"),
	email: text("email").notNull().unique(),
	oidcIssuerId: text("oidc_issuer_id").unique(),
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	paddleCustomerId: text("paddle_customer_id").unique(),
	polarCustomerId: text("polar_customer_id").unique(),
	paymentProvider: paymentProviders("payment_provider")
		.notNull()
		.default("paddle"),
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
	// DEV: This field is present for administration purposes and not intended to be used
	// by the application itself. Please do not remove it.
	isAddressed: boolean("is_addressed"),
	id: uuid("id").defaultRandom().primaryKey(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	ticketNumber: bigint("ticket_number", { mode: "bigint" }),
});

export const customerPurchases = pgTable("customer_purchase", {
	planType: planTypes("plan_type").notNull(),
	productType: productTypes("product_type").notNull(),
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	renewOn: timestamp("renew_on", { withTimezone: true }),
	cancelledOn: timestamp("cancelled_on", { withTimezone: true }),
	customerId: uuid("customer_id")
		.notNull()
		.references(() => customers.id),
	createdOn: timestamp("created_on", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedOn: timestamp("updated_on", { withTimezone: true })
		.defaultNow()
		.notNull(),
});
