import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { render } from "@react-email/render";
import { formatDateToNaiveDate, zodBoolAsString } from "@ryot/ts-utils";
import { Unkey } from "@unkey/api";
import dayjs, { type Dayjs } from "dayjs";
import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { GraphQLClient } from "graphql-request";
import { createTransport } from "nodemailer";
import { Issuer } from "openid-client";
import type { ReactElement } from "react";
import { createCookie } from "react-router";
import { Honeypot } from "remix-utils/honeypot/server";
import { match } from "ts-pattern";
import { z } from "zod";
import * as schema from "~/drizzle/schema.server";
import {
	PlanTypes,
	ProductTypes,
	type TPlanTypes,
} from "~/drizzle/schema.server";

// The number of days after a subscription expires that we allow access
export const GRACE_PERIOD = 7;

export const TEMP_DIRECTORY =
	process.env.NODE_ENV === "development" ? "/tmp" : "tmp";

export const serverVariablesSchema = z.object({
	FRONTEND_URL: z.string(),
	UNKEY_API_ID: z.string(),
	DATABASE_URL: z.string(),
	RYOT_BASE_URL: z.string(),
	UNKEY_ROOT_KEY: z.string(),
	PADDLE_PRICE_IDS: z.string(),
	SERVER_SMTP_USER: z.string(),
	SERVER_SMTP_SERVER: z.string(),
	PADDLE_CLIENT_TOKEN: z.string(),
	PADDLE_SERVER_TOKEN: z.string(),
	SERVER_SMTP_MAILBOX: z.string(),
	NODE_ENV: z.string().optional(),
	SERVER_SMTP_PASSWORD: z.string(),
	SERVER_OIDC_CLIENT_ID: z.string(),
	SERVER_OIDC_ISSUER_URL: z.string(),
	SERVER_OIDC_CLIENT_SECRET: z.string(),
	SERVER_ADMIN_ACCESS_TOKEN: z.string(),
	PADDLE_WEBHOOK_SECRET_KEY: z.string(),
	SERVER_SMTP_PORT: z.string().optional(),
	PADDLE_SANDBOX: zodBoolAsString.optional(),
	SERVER_SMTP_SECURE: zodBoolAsString.optional(),
});

export const serverVariables = serverVariablesSchema.parse(process.env);

export const OAUTH_CALLBACK_URL = `${serverVariables.FRONTEND_URL}/callback`;

export const pricesSchema = z.array(
	z.object({
		type: z.enum(ProductTypes.enum),
		prices: z.array(
			z.object({
				trial: z.number().optional(),
				amount: z.number().optional(),
				priceId: z.string().optional(),
				linkToGithub: z.boolean().optional(),
				name: z.enum(PlanTypes.enum),
			}),
		),
	}),
);

export type TPrices = z.infer<typeof pricesSchema>;

export const prices = pricesSchema.parse(
	JSON.parse(serverVariables.PADDLE_PRICE_IDS),
);

export const getProductAndPlanTypeByPriceId = (priceId: string) => {
	for (const product of prices)
		for (const price of product.prices)
			if (price.priceId === priceId)
				return { productType: product.type, planType: price.name };
	throw new Error("Price ID not found");
};

export const db = drizzle(serverVariables.DATABASE_URL, {
	schema,
	logger: serverVariables.NODE_ENV === "development",
});

export const oauthClient = async () => {
	const issuer = await Issuer.discover(serverVariables.SERVER_OIDC_ISSUER_URL);
	const client = new issuer.Client({
		client_id: serverVariables.SERVER_OIDC_CLIENT_ID,
		client_secret: serverVariables.SERVER_OIDC_CLIENT_SECRET,
		redirect_uris: [OAUTH_CALLBACK_URL],
	});
	return client;
};

export const getPaddleServerClient = () =>
	new Paddle(serverVariables.PADDLE_SERVER_TOKEN, {
		environment: serverVariables.PADDLE_SANDBOX
			? Environment.sandbox
			: undefined,
	});

export const sendEmail = async (input: {
	cc?: string;
	subject: string;
	recipient: string;
	element: ReactElement;
}) => {
	const client = createTransport({
		host: serverVariables.SERVER_SMTP_SERVER,
		secure: serverVariables.SERVER_SMTP_SECURE,
		port: serverVariables.SERVER_SMTP_PORT
			? Number(serverVariables.SERVER_SMTP_PORT)
			: undefined,
		auth: {
			user: serverVariables.SERVER_SMTP_USER,
			pass: serverVariables.SERVER_SMTP_PASSWORD,
		},
	});
	const html = await render(input.element, { pretty: true });
	const text = await render(input.element, { plainText: true });
	const log = {
		cc: input.cc,
		subject: input.subject,
		recipient: input.recipient,
	};
	console.log("Sending email:", log);
	const resp = await client.sendMail({
		text,
		html,
		cc: input.cc,
		to: input.recipient,
		subject: input.subject,
		from: serverVariables.SERVER_SMTP_MAILBOX,
	});
	console.log("Sent email:", log);
	return resp.messageId;
};

export const websiteAuthCookie = createCookie("WebsiteAuth", {
	maxAge: 60 * 60 * 24 * 365,
	path: "/",
});

export const calculateRenewalDate = (
	planType: TPlanTypes,
	baseDate?: Date | dayjs.Dayjs,
) => {
	const date = baseDate ? dayjs(baseDate) : dayjs();
	return match(planType)
		.with("free", "lifetime", () => null)
		.with("yearly", () => date.add(1, "year"))
		.with("monthly", () => date.add(1, "month"))
		.exhaustive();
};

const getRenewOnFromPlanType = (planType: TPlanTypes, createdOn: Date) => {
	const renewalDate = calculateRenewalDate(planType, createdOn);
	return renewalDate ? formatDateToNaiveDate(renewalDate) : null;
};

export const getCustomerFromCookie = async (request: Request) => {
	const cookie = await websiteAuthCookie.parse(request.headers.get("cookie"));
	if (!cookie || Object.keys(cookie).length === 0) return null;
	const customerId = z.string().parse(cookie);

	return await db.query.customers.findFirst({
		where: eq(schema.customers.id, customerId),
	});
};

export const getCustomerWithActivePurchase = async (request: Request) => {
	const customer = await getCustomerFromCookie(request);
	if (!customer) return null;

	const activePurchase = await db.query.customerPurchases.findFirst({
		orderBy: [desc(schema.customerPurchases.createdOn)],
		where: and(
			eq(schema.customerPurchases.customerId, customer.id),
			isNull(schema.customerPurchases.cancelledOn),
		),
	});

	return {
		...customer,
		activePurchase,
		planType: activePurchase?.planType || null,
		hasCancelled: !!activePurchase?.cancelledOn,
		productType: activePurchase?.productType || null,
		renewOn: activePurchase
			? getRenewOnFromPlanType(
					activePurchase.planType,
					activePurchase.createdOn,
				)
			: null,
	};
};

export const serverGqlService = new GraphQLClient(
	`${serverVariables.RYOT_BASE_URL}/graphql`,
	{ headers: { Connection: "keep-alive" } },
);

export const honeypot = new Honeypot();

export const customDataSchema = z.object({
	customerId: z.string(),
});

export type CustomData = z.infer<typeof customDataSchema>;

export const createUnkeyKey = async (
	customer: typeof schema.customers.$inferSelect,
	renewOn?: Dayjs,
) => {
	const unkey = new Unkey({ rootKey: serverVariables.UNKEY_ROOT_KEY });
	const created = await unkey.keys.create({
		name: customer.email,
		externalId: customer.id,
		apiId: serverVariables.UNKEY_API_ID,
		meta: renewOn ? { expiry: formatDateToNaiveDate(renewOn) } : undefined,
	});
	if (created.error) throw new Error(created.error.message);
	return created.result;
};
