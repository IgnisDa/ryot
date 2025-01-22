import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { render } from "@react-email/render";
import { createCookie } from "@remix-run/node";
import { formatDateToNaiveDate, zodBoolAsString } from "@ryot/ts-utils";
import { Unkey } from "@unkey/api";
import type { Dayjs } from "dayjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { GraphQLClient } from "graphql-request";
import { createTransport } from "nodemailer";
import { Issuer } from "openid-client";
import { Honeypot } from "remix-utils/honeypot/server";
import { z } from "zod";
import * as schema from "~/drizzle/schema.server";
import { PlanTypes, ProductTypes } from "~/drizzle/schema.server";

// The number of days after a subscription expires that we allow access
export const GRACE_PERIOD = 7;

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
	PADDLE_SANDBOX: zodBoolAsString.optional(),
});

export const serverVariables = serverVariablesSchema.parse(process.env);

export const OAUTH_CALLBACK_URL = `${serverVariables.FRONTEND_URL}/callback`;

export const pricesSchema = z.array(
	z.object({
		type: z.nativeEnum(ProductTypes.Values),
		prices: z.array(
			z.object({
				trial: z.number().optional(),
				amount: z.number().optional(),
				priceId: z.string().optional(),
				linkToGithub: z.boolean().optional(),
				name: z.nativeEnum(PlanTypes.Values),
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

export const sendEmail = async (
	recipient: string,
	subject: string,
	element: JSX.Element,
) => {
	const client = createTransport({
		secure: true,
		host: serverVariables.SERVER_SMTP_SERVER,
		auth: {
			user: serverVariables.SERVER_SMTP_USER,
			pass: serverVariables.SERVER_SMTP_PASSWORD,
		},
	});
	const html = await render(element, { pretty: true });
	const text = await render(element, { plainText: true });
	console.log(`Sending email to ${recipient} with subject ${subject}`);
	const resp = await client.sendMail({
		text,
		html,
		subject,
		to: recipient,
		from: '"Ryot" <no-reply@ryot.io>',
	});
	return resp.messageId;
};

export const websiteAuthCookie = createCookie("WebsiteAuth", {
	maxAge: 60 * 60 * 24 * 365,
	path: "/",
});

export const getCustomerFromCookie = async (request: Request) => {
	const cookie = await websiteAuthCookie.parse(request.headers.get("cookie"));
	if (!cookie || Object.keys(cookie).length === 0) return null;
	const customerId = z.string().parse(cookie);
	return await db.query.customers.findFirst({
		where: eq(schema.customers.id, customerId),
	});
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
