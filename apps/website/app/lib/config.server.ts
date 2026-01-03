import { memoize, zodBoolAsString } from "@ryot/ts-utils";
import { drizzle } from "drizzle-orm/postgres-js";
import { GraphQLClient } from "graphql-request";
import { createCookie } from "react-router";
import { z } from "zod";
import * as schema from "~/drizzle/schema.server";
import { PlanTypes, ProductTypes } from "~/drizzle/schema.server";

// The number of days after a subscription expires that we allow access
export const GRACE_PERIOD = 7;
export const IS_DEVELOPMENT_ENV = process.env.NODE_ENV === "development";
export const TEMP_DIRECTORY = IS_DEVELOPMENT_ENV ? "/tmp" : "tmp";

const serverVariablesSchema = z.object({
	FRONTEND_URL: z.string(),
	UNKEY_API_ID: z.string(),
	DATABASE_URL: z.string(),
	RYOT_BASE_URL: z.string(),
	UNKEY_ROOT_KEY: z.string(),
	PADDLE_PRICE_IDS: z.string(),
	SERVER_SMTP_USER: z.string(),
	SERVER_SMTP_SERVER: z.string(),
	TURNSTILE_SITE_KEY: z.string(),
	PADDLE_CLIENT_TOKEN: z.string(),
	PADDLE_SERVER_TOKEN: z.string(),
	SERVER_SMTP_MAILBOX: z.string(),
	TURNSTILE_SECRET_KEY: z.string(),
	SERVER_SMTP_PASSWORD: z.string(),
	SERVER_OIDC_CLIENT_ID: z.string(),
	SERVER_OIDC_ISSUER_URL: z.string(),
	SERVER_ADMIN_ACCESS_TOKEN: z.string(),
	SERVER_OIDC_CLIENT_SECRET: z.string(),
	PADDLE_WEBHOOK_SECRET_KEY: z.string(),
	SERVER_SMTP_PORT: z.string().optional(),
	PADDLE_SANDBOX: zodBoolAsString.optional(),
	SERVER_SMTP_SECURE: zodBoolAsString.optional(),
});

export const getServerVariables = memoize(() =>
	serverVariablesSchema.parse(process.env),
);

export const getOauthCallbackUrl = memoize(
	() => `${getServerVariables().FRONTEND_URL}/callback`,
);

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

export const getPrices = memoize(() =>
	pricesSchema.parse(JSON.parse(getServerVariables().PADDLE_PRICE_IDS)),
);

export const websiteAuthCookie = createCookie("WebsiteAuth", {
	path: "/",
	maxAge: 60 * 60 * 24 * 365,
});

export const getDb = memoize(() =>
	drizzle(getServerVariables().DATABASE_URL, {
		schema,
		logger: IS_DEVELOPMENT_ENV,
	}),
);

export const getServerGqlService = memoize(
	() =>
		new GraphQLClient(`${getServerVariables().RYOT_BASE_URL}/graphql`, {
			headers: { Connection: "keep-alive" },
		}),
);

export const paddleCustomDataSchema = z.object({
	customerId: z.string(),
});

export type PaddleCustomData = z.infer<typeof paddleCustomDataSchema>;
