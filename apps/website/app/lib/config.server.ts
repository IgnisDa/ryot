import { createHash } from "node:crypto";
import { Polar } from "@polar-sh/sdk";
import { memoize, zodBoolAsString } from "@ryot/ts-utils";
import { Unkey } from "@unkey/api";
import { drizzle } from "drizzle-orm/postgres-js";
import { GraphQLClient } from "graphql-request";
import { createCookie } from "react-router";
import { z } from "zod";
import * as schema from "~/drizzle/schema.server";
import {
	getActivePaymentCatalog,
	getPaymentEnvironment,
} from "./payment-catalog";

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
	SERVER_SMTP_USER: z.string(),
	SERVER_SMTP_SERVER: z.string(),
	TURNSTILE_SITE_KEY: z.string(),
	POLAR_ACCESS_TOKEN: z.string(),
	PADDLE_CLIENT_TOKEN: z.string(),
	PADDLE_SERVER_TOKEN: z.string(),
	SERVER_SMTP_MAILBOX: z.string(),
	TURNSTILE_SECRET_KEY: z.string(),
	SERVER_SMTP_PASSWORD: z.string(),
	SERVER_OIDC_CLIENT_ID: z.string(),
	SERVER_OIDC_ISSUER_URL: z.string(),
	POLAR_WEBHOOK_SECRET_KEY: z.string(),
	SERVER_ADMIN_ACCESS_TOKEN: z.string(),
	SERVER_OIDC_CLIENT_SECRET: z.string(),
	PADDLE_WEBHOOK_SECRET_KEY: z.string(),
	POLAR_AB_PERCENT: z.string().optional(),
	SERVER_SMTP_PORT: z.string().optional(),
	POLAR_SANDBOX: zodBoolAsString.optional(),
	PADDLE_SANDBOX: zodBoolAsString.optional(),
	SERVER_SMTP_SECURE: zodBoolAsString.optional(),
});

export const getServerVariables = memoize(() =>
	serverVariablesSchema.parse(process.env),
);

export const getOauthCallbackUrl = memoize(
	() => `${getServerVariables().FRONTEND_URL}/callback`,
);

export const getPrices = memoize(() => {
	const { PADDLE_SANDBOX } = getServerVariables();
	return getActivePaymentCatalog(
		"paddle",
		getPaymentEnvironment(PADDLE_SANDBOX),
	);
});

export type TPrices = ReturnType<typeof getPrices>;

export const getPolarProducts = memoize(() => {
	const { POLAR_SANDBOX } = getServerVariables();
	return getActivePaymentCatalog("polar", getPaymentEnvironment(POLAR_SANDBOX));
});

export const getPolarAbPercent = memoize(() => {
	const percent = getServerVariables().POLAR_AB_PERCENT;
	return percent ? Number.parseInt(percent, 10) : 0;
});

export const getPolarAccessToken = memoize(() => {
	return getServerVariables().POLAR_ACCESS_TOKEN;
});

export const getPolarWebhookSecret = memoize(() => {
	return getServerVariables().POLAR_WEBHOOK_SECRET_KEY;
});

export const isPolarSandbox = memoize(() => {
	return getServerVariables().POLAR_SANDBOX === true;
});

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

export const getUnkeyClient = memoize(() => {
	return new Unkey({ rootKey: getServerVariables().UNKEY_ROOT_KEY });
});

export const getPolarClient = memoize(() => {
	const accessToken = getPolarAccessToken();
	return new Polar({
		accessToken,
		server: isPolarSandbox() ? "sandbox" : "production",
	});
});

export const paddleCustomDataSchema = z.object({
	customerId: z.string(),
});

export type PaddleCustomData = z.infer<typeof paddleCustomDataSchema>;

export const findPolarProductId = (
	productType: schema.TProductTypes,
	planType: schema.TPlanTypes,
): string | null => {
	const products = getPolarProducts();

	const product = products.find((p) => p.type === productType);
	if (!product) return null;

	const price = product.prices.find((p) => p.name === planType);
	return price?.productId || null;
};

export const assignPaymentProvider = (
	email: string,
): schema.TPaymentProviders => {
	const abPercent = getPolarAbPercent();
	if (abPercent === 0) return "paddle";

	const hash = createHash("sha256").update(email).digest("hex");
	const hashInt = Number.parseInt(hash.substring(0, 8), 16);
	const bucket = hashInt % 100;

	return bucket < abPercent ? "polar" : "paddle";
};
