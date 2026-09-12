import { parseWithZod } from "@conform-to/zod/v4";
import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { render } from "@react-email/components";
import dayjs, { type Dayjs } from "dayjs";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { createTransport } from "nodemailer";
import * as openidClient from "openid-client";
import type { ReactElement } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import z from "zod";

import type { TPlanTypes } from "~/drizzle/schema.server";
import * as schema from "~/drizzle/schema.server";

import {
	getDb,
	getServerVariables,
	getUnkeyClient,
	IS_DEVELOPMENT_ENV,
	websiteAuthCookie,
} from "./config.server";
import { fromPromise } from "./effect.server";
import {
	getActivePaymentCatalog,
	getLegacyPaymentCatalog,
	getPaymentEnvironment,
} from "./payment-catalog";

/**
 * Format a `Date` into a Rust `NaiveDate`
 */
export const formatDateToNaiveDate = (t: Date | Dayjs) => dayjs(t).format("YYYY-MM-DD");

export const processSubmission = <Schema extends z.ZodType>(
	formData: FormData,
	zodSchema: Schema,
) => {
	const submission = parseWithZod(formData, { schema: zodSchema });
	if (submission.status !== "success") {
		// oxlint-disable-next-line only-throw-error
		throw Response.json({ submission, status: "idle" } as const, { status: 422 });
	}
	return submission.value;
};

export const getActionIntent = (request: Request) => {
	const url = new URL(request.url);
	const intent = url.searchParams.get("intent");
	invariant(intent);
	return intent;
};

export const getClientIp = (request: Request): string | undefined => {
	const cfConnectingIp = request.headers.get("cf-connecting-ip");
	if (cfConnectingIp) {
		return cfConnectingIp.trim();
	}

	const xForwardedFor = request.headers.get("x-forwarded-for");
	if (xForwardedFor) {
		const firstIp = xForwardedFor.split(",")[0];
		return firstIp.trim();
	}

	return undefined;
};

export const getProductAndPlanTypeByPriceId = (priceId: string) => {
	const { PADDLE_SANDBOX } = getServerVariables();
	const environment = getPaymentEnvironment(PADDLE_SANDBOX);
	const catalogs = [
		getActivePaymentCatalog("paddle", environment),
		getLegacyPaymentCatalog("paddle", environment),
	];

	for (const catalog of catalogs) {
		for (const product of catalog) {
			for (const price of product.prices) {
				if (price.priceId === priceId) {
					return { planType: price.name, productType: product.type };
				}
			}
		}
	}

	throw new Error("Price ID not found");
};

export const getProductAndPlanTypeByPolarIds = (productId: string, priceId?: string | null) => {
	const { POLAR_SANDBOX } = getServerVariables();
	const environment = getPaymentEnvironment(POLAR_SANDBOX);
	const catalogs = [
		getActivePaymentCatalog("polar", environment),
		getLegacyPaymentCatalog("polar", environment),
	];

	for (const catalog of catalogs) {
		for (const product of catalog) {
			for (const price of product.prices) {
				if (price.productId === productId && (priceId == null || price.priceId === priceId)) {
					return { planType: price.name, productType: product.type };
				}
			}
		}
	}

	return null;
};

export const oauthConfig = fromPromise(() => {
	const serverVariables = getServerVariables();
	return openidClient.discovery(
		new URL(serverVariables.SERVER_OIDC_ISSUER_URL),
		serverVariables.SERVER_OIDC_CLIENT_ID,
		serverVariables.SERVER_OIDC_CLIENT_SECRET,
	);
});

export const getPaddleServerClient = () => {
	const serverVariables = getServerVariables();
	return new Paddle(serverVariables.PADDLE_SERVER_TOKEN, {
		environment: serverVariables.PADDLE_SANDBOX ? Environment.sandbox : undefined,
	});
};

export const sendEmail = (input: {
	cc?: string;
	subject: string;
	recipient: string;
	element: ReactElement;
}) =>
	Effect.gen(function* () {
		if (IS_DEVELOPMENT_ENV) {
			yield* Effect.logWarning("Email sending is disabled in development mode.");
			return "dev-mode-email";
		}
		const serverVariables = getServerVariables();
		const client = createTransport({
			host: serverVariables.SERVER_SMTP_SERVER,
			secure: serverVariables.SERVER_SMTP_SECURE,
			auth: { user: serverVariables.SERVER_SMTP_USER, pass: serverVariables.SERVER_SMTP_PASSWORD },
			port: serverVariables.SERVER_SMTP_PORT ? Number(serverVariables.SERVER_SMTP_PORT) : undefined,
		});
		const html = yield* fromPromise(() => render(input.element, { pretty: true }));
		const text = yield* fromPromise(() => render(input.element, { plainText: true }));
		const log = { cc: input.cc, subject: input.subject, recipient: input.recipient };
		yield* Effect.log("Sending email:", log);
		const resp = yield* fromPromise(() =>
			client.sendMail({
				text,
				html,
				cc: input.cc,
				to: input.recipient,
				subject: input.subject,
				from: serverVariables.SERVER_SMTP_MAILBOX,
			}),
		);
		yield* Effect.log("Sent email:", log);
		return resp.messageId;
	});

export const calculateRenewalDate = (planType: TPlanTypes, baseDate?: Date | Dayjs) => {
	const date = baseDate ? dayjs(baseDate) : dayjs();
	return match(planType)
		.with("free", "lifetime", () => null)
		.with("yearly", () => date.add(1, "year"))
		.with("monthly", () => date.add(1, "month"))
		.exhaustive();
};

export const getCustomerFromCookie = (request: Request) =>
	Effect.gen(function* () {
		const cookie = yield* fromPromise(() => websiteAuthCookie.parse(request.headers.get("cookie")));
		if (!cookie || Object.keys(cookie).length === 0) {
			return null;
		}
		const customerId = z.string().parse(cookie);

		return yield* fromPromise(() =>
			getDb().query.customer.findFirst({ where: eq(schema.customer.id, customerId) }),
		);
	});

export const getCustomerWithActivePurchase = (request: Request) =>
	Effect.gen(function* () {
		const customer = yield* getCustomerFromCookie(request);
		if (!customer) {
			return null;
		}

		const activePurchase = yield* fromPromise(() =>
			getDb().query.customerPurchase.findFirst({
				orderBy: [desc(schema.customerPurchase.createdOn)],
				where: and(
					eq(schema.customerPurchase.customerId, customer.id),
					isNull(schema.customerPurchase.cancelledOn),
				),
			}),
		);

		return {
			...customer,
			activePurchase,
			planType: activePurchase?.planType ?? null,
			hasCancelled: !!activePurchase?.cancelledOn,
			productType: activePurchase?.productType ?? null,
			ryotUserId: activePurchase?.productType === "cloud" ? customer.ryotUserId : null,
			unkeyKeyId: activePurchase?.productType === "self_hosted" ? customer.unkeyKeyId : null,
			renewOn: activePurchase?.renewOn ? formatDateToNaiveDate(activePurchase.renewOn) : null,
		};
	});

export const createUnkeyKey = (customer: typeof schema.customer.$inferSelect, renewOn?: Dayjs) => {
	const unkey = getUnkeyClient();
	const serverVariables = getServerVariables();
	return fromPromise(() =>
		unkey.keys.createKey({
			name: customer.email,
			externalId: customer.id,
			apiId: serverVariables.UNKEY_API_ID,
			meta: renewOn ? { expiry: formatDateToNaiveDate(renewOn) } : undefined,
		}),
	).pipe(Effect.map((created) => created.data));
};

export const verifyTurnstileToken = (input: { token: string; remoteIp?: string }) =>
	Effect.gen(function* () {
		const serverVariables = getServerVariables();
		return yield* Effect.gen(function* () {
			const response = yield* fromPromise(() =>
				fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						response: input.token,
						secret: serverVariables.TURNSTILE_SECRET_KEY,
						...(input.remoteIp && { remoteip: input.remoteIp }),
					}),
				}),
			);

			const jsonData = yield* fromPromise(() => response.json());
			return jsonData.success === true;
		}).pipe(
			Effect.catch((error) =>
				Effect.gen(function* () {
					yield* Effect.logError("Turnstile verification error:", error);
					return false;
				}),
			),
		);
	});

export const validateTurnstile = (request: Request, token: string) =>
	Effect.gen(function* () {
		const isTurnstileValid = yield* verifyTurnstileToken({ token, remoteIp: getClientIp(request) });
		if (!isTurnstileValid) {
			throw new Error("CAPTCHA verification failed. Please try again.");
		}
	});
