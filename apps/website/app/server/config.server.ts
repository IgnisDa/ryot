import { createPolar } from "@polar-sh/sdk/2026-04";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { memoize } from "@ryot-app/ts-utils/lodash";
import { Unkey } from "@unkey/api";
import { drizzle } from "drizzle-orm/postgres-js";
import { z } from "zod";

import * as schema from "~/drizzle/schema.server";
import {
	findPaymentPlan,
	getActivePaymentCatalog,
	getPaymentEnvironment,
} from "~/features/billing/catalog";

export const IS_DEVELOPMENT_ENV = process.env.NODE_ENV === "development";

const zodBoolAsString = z
	.string()
	.regex(/^(true|false)$/, 'Must be a boolean string ("true" or "false")')
	.transform((value) => value === "true");

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
	UNKEY_SERVER_URL: z.url().optional(),
	SERVER_ADMIN_ACCESS_TOKEN: z.string(),
	SERVER_OIDC_CLIENT_SECRET: z.string(),
	PADDLE_WEBHOOK_SECRET_KEY: z.string(),
	POLAR_AB_PERCENT: z.string().optional(),
	SERVER_SMTP_PORT: z.string().optional(),
	POLAR_SANDBOX: zodBoolAsString.optional(),
	PADDLE_SANDBOX: zodBoolAsString.optional(),
	SERVER_SMTP_SECURE: zodBoolAsString.optional(),
	UNKEY_PRO_VERIFICATION_KEY: z.string().optional(),
	TURNSTILE_VERIFY_URL: z
		.url()
		.default("https://challenges.cloudflare.com/turnstile/v0/siteverify"),
});

export const getServerVariables = memoize(() => serverVariablesSchema.parse(process.env));

export const paymentEnvironment = (provider: schema.TPaymentProviders) => {
	const config = getServerVariables();
	return getPaymentEnvironment(
		provider === "paddle" ? config.PADDLE_SANDBOX : config.POLAR_SANDBOX,
	);
};

export const getPrices = (provider: schema.TPaymentProviders = "paddle") =>
	getActivePaymentCatalog(provider, paymentEnvironment(provider));

const getPolarAbPercent = memoize(() => {
	const percent = getServerVariables().POLAR_AB_PERCENT;
	return percent ? Number.parseInt(percent, 10) : 0;
});

export const getDb = memoize(() =>
	drizzle(getServerVariables().DATABASE_URL, { schema, logger: IS_DEVELOPMENT_ENV }),
);

export const getUnkeyClient = memoize(() => {
	return new Unkey({
		timeoutMs: 4000,
		retryConfig: { strategy: "none" },
		rootKey: getServerVariables().UNKEY_ROOT_KEY,
		serverURL: getServerVariables().UNKEY_SERVER_URL,
	});
});

export const getProKeyVerifier = memoize(() => {
	const rootKey = getServerVariables().UNKEY_PRO_VERIFICATION_KEY;
	return rootKey
		? new Unkey({
				rootKey,
				timeoutMs: 4000,
				retryConfig: { strategy: "none" },
				serverURL: getServerVariables().UNKEY_SERVER_URL,
			})
		: undefined;
});

export const getPolarClient = memoize(() =>
	createPolar({
		environment: paymentEnvironment("polar"),
		accessToken: getServerVariables().POLAR_ACCESS_TOKEN,
	}),
);

export const paddleCustomDataSchema = z.object({ customerId: z.string() });

export type PaddleCustomData = z.infer<typeof paddleCustomDataSchema>;

export const findPolarProductId = (
	productType: schema.TProductTypes,
	planType: schema.TPlanTypes,
) =>
	findPaymentPlan(
		"polar",
		paymentEnvironment("polar"),
		(type, price) => type === productType && price.name === planType,
		["active"],
	)?.price.productId;

export const assignPaymentProvider = (email: string): schema.TPaymentProviders => {
	const abPercent = getPolarAbPercent();
	if (abPercent === 0) {
		return "paddle";
	}

	const hash = sha256Hex(email);
	const hashInt = Number.parseInt(hash.substring(0, 8), 16);
	const bucket = hashInt % 100;

	return bucket < abPercent ? "polar" : "paddle";
};
