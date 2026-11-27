import { randomUuid } from "@ryot-app/testing/random";
import { webRequest } from "@ryot-app/testing/web-request";
import { hmacDigest } from "@ryot-app/ts-utils/crypto";
import { Clock, DateTime, Effect, Schema } from "effect";

import { findPaymentPlan } from "../../../app/features/billing/catalog";
import { paddleSecret, polarSecret } from "./harness";

type Payment = {
	eventId?: string;
	customerId?: string;
	providerCustomerId: string;
	product?: "cloud" | "self_hosted";
	kind?: "paid" | "resumed" | "cancelled";
	plan?: "yearly" | "monthly" | "lifetime";
};

const encodeBody = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export const deliverPaddleEvent = Effect.fn(function* (
	origin: string,
	input: Payment & { invalidSignature?: boolean },
) {
	const priceId = findPaymentPlan(
		"paddle",
		"sandbox",
		(product, candidate) =>
			product === (input.product ?? "self_hosted") && candidate.name === (input.plan ?? "monthly"),
		["active"],
	)?.price.priceId;
	const kind = input.kind ?? "paid";
	const body = yield* encodeBody({
		event_id: input.eventId ?? (yield* randomUuid),
		occurred_at: DateTime.formatIso(yield* DateTime.now),
		event_type: {
			paid: "transaction.completed",
			resumed: "subscription.resumed",
			cancelled: "subscription.canceled",
		}[kind],
		data: {
			items: [],
			customer_id: input.providerCustomerId,
			custom_data: input.customerId && { customerId: input.customerId },
			...(kind === "paid"
				? { payments: [], details: { tax_rates_used: [], line_items: [{ price_id: priceId }] } }
				: { billing_cycle: { frequency: 1, interval: "month" } }),
		},
	});
	const timestamp = Math.floor((yield* Clock.currentTimeMillis) / 1000);
	const signature = Buffer.from(
		hmacDigest("sha256", input.invalidSignature ? "other" : paddleSecret, `${timestamp}:${body}`),
	).toString("hex");
	return yield* webRequest(new URL("/paddle-webhook", origin), {
		body,
		method: "POST",
		headers: { "Paddle-Signature": `ts=${timestamp};h1=${signature}` },
	});
});

export const deliverPolarEvent = Effect.fn(function* (
	origin: string,
	input: Payment & { invalidSignature?: boolean },
) {
	const price = findPaymentPlan(
		"polar",
		"sandbox",
		(product, candidate) =>
			product === (input.product ?? "self_hosted") && candidate.name === (input.plan ?? "monthly"),
		["active"],
	)?.price;
	const id = input.eventId ?? (yield* randomUuid);
	const body = yield* encodeBody({
		type: input.kind === "cancelled" ? "subscription.revoked" : "order.paid",
		data: {
			product_id: price?.productId,
			items: [{ product_price_id: price?.priceId }],
			customer: { id: input.providerCustomerId, external_id: input.customerId },
		},
	});
	const timestamp = Math.floor((yield* Clock.currentTimeMillis) / 1000);
	const signature = Buffer.from(
		hmacDigest(
			"sha256",
			input.invalidSignature ? "other" : polarSecret,
			`${id}.${timestamp}.${body}`,
		),
	).toString("base64");
	return yield* webRequest(new URL("/polar-webhook", origin), {
		body,
		method: "POST",
		headers: {
			"Webhook-Id": id,
			"Webhook-Timestamp": String(timestamp),
			"Webhook-Signature": `v1,${signature}`,
		},
	});
});
