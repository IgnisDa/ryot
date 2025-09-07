import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { render } from "@react-email/components";
import { formatDateToNaiveDate } from "@ryot/ts-utils/index";
import { Unkey } from "@unkey/api";
import dayjs, { type Dayjs } from "dayjs";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createTransport } from "nodemailer";
import * as openidClient from "openid-client";
import type { ReactElement } from "react";
import { match } from "ts-pattern";
import z from "zod";
import * as schema from "~/drizzle/schema.server";
import type { TPlanTypes } from "~/drizzle/schema.server";
import {
	IS_DEVELOPMENT_ENV,
	db,
	prices,
	serverVariables,
	websiteAuthCookie,
} from "./config.server";

export const getClientIp = (request: Request): string | undefined => {
	const cfConnectingIp = request.headers.get("cf-connecting-ip");
	if (cfConnectingIp) return cfConnectingIp.trim();

	const xForwardedFor = request.headers.get("x-forwarded-for");
	if (xForwardedFor) {
		const firstIp = xForwardedFor.split(",")[0];
		return firstIp?.trim();
	}

	return undefined;
};

export const getProductAndPlanTypeByPriceId = (priceId: string) => {
	for (const product of prices)
		for (const price of product.prices)
			if (price.priceId === priceId)
				return { productType: product.type, planType: price.name };
	throw new Error("Price ID not found");
};

export const oauthConfig = async () => {
	const config = await openidClient.discovery(
		new URL(serverVariables.SERVER_OIDC_ISSUER_URL),
		serverVariables.SERVER_OIDC_CLIENT_ID,
		serverVariables.SERVER_OIDC_CLIENT_SECRET,
	);
	return config;
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
	if (IS_DEVELOPMENT_ENV) {
		console.warn("Email sending is disabled in development mode.");
		return "dev-mode-email";
	}
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
		ryotUserId:
			activePurchase?.productType === "cloud" ? customer.ryotUserId : null,
		renewOn: activePurchase?.renewOn
			? formatDateToNaiveDate(activePurchase.renewOn)
			: null,
		unkeyKeyId:
			activePurchase?.productType === "self_hosted"
				? customer.unkeyKeyId
				: null,
	};
};

export const createUnkeyKey = async (
	customer: typeof schema.customers.$inferSelect,
	renewOn?: Dayjs,
) => {
	const unkey = new Unkey({ rootKey: serverVariables.UNKEY_ROOT_KEY });
	const created = await unkey.keys.createKey({
		name: customer.email,
		externalId: customer.id,
		apiId: serverVariables.UNKEY_API_ID,
		meta: renewOn ? { expiry: formatDateToNaiveDate(renewOn) } : undefined,
	});
	return created.data;
};

export const verifyTurnstileToken = async (input: {
	token: string;
	remoteIp?: string;
}) => {
	try {
		const response = await fetch(
			"https://challenges.cloudflare.com/turnstile/v0/siteverify",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					response: input.token,
					secret: serverVariables.TURNSTILE_SECRET_KEY,
					...(input.remoteIp && { remoteip: input.remoteIp }),
				}),
			},
		);

		const data = await response.json();
		return data.success === true;
	} catch (error) {
		console.error("Turnstile verification error:", error);
		return false;
	}
};
