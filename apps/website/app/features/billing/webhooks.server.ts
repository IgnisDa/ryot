import { EventName } from "@paddle/paddle-node-sdk";
import { webhooks } from "@polar-sh/sdk/2026-04";
import { Effect, Schema } from "effect";

import { getServerVariables, paddleCustomDataSchema } from "~/server/config.server";
import { fromPromise } from "~/server/effect.server";

import { type PaymentEvent, processPaymentEvent } from "./events.server";
import { getPaddleServerClient } from "./providers.server";

const respond = (code: string, status = 200) => Response.json({ code }, { status });

const PolarEventData = Schema.Struct({
	product_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
	customer: Schema.Struct({
		id: Schema.NonEmptyString,
		external_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
	}),
	items: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({ product_price_id: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
		),
	),
});

const handle = (event: undefined | PaymentEvent) =>
	event
		? processPaymentEvent(event).pipe(
				Effect.as(respond("processed")),
				Effect.catchCause((cause) =>
					Effect.logError("Billing event failed", {
						cause,
						eventId: event.id,
						provider: event.provider,
					}).pipe(Effect.as(respond("processing-failed", 503))),
				),
			)
		: Effect.succeed(respond("ignored-event"));

export const handlePaddleWebhook = Effect.fn(function* (request: Request) {
	const signature = request.headers.get("paddle-signature");
	if (!signature) {
		return respond("missing-signature", 401);
	}
	const body = yield* fromPromise(() => request.text());
	const verification = yield* fromPromise(() =>
		getPaddleServerClient().webhooks.unmarshal(
			body,
			getServerVariables().PADDLE_WEBHOOK_SECRET_KEY,
			signature,
		),
	).pipe(Effect.result);
	if (verification._tag === "Failure") {
		const error = verification.failure.cause;
		return error instanceof Error &&
			error.message.toLowerCase().includes("signature verification failed")
			? respond("invalid-signature", 401)
			: respond("invalid-payload", 400);
	}
	const { data, eventId, eventType } = verification.success;
	if (!eventId) {
		return respond("missing-event-id", 400);
	}
	if (eventType === EventName.TransactionCompleted) {
		const priceId = data.details?.lineItems[0]?.priceId;
		if (!data.customerId || !priceId) {
			return respond("invalid-purchase", 400);
		}
		const customData = paddleCustomDataSchema.safeParse(data.customData);
		return yield* handle({
			priceId,
			id: eventId,
			kind: "paid",
			provider: "paddle",
			providerCustomerId: data.customerId,
			websiteCustomerId: customData.data?.customerId,
		});
	}
	if (
		eventType === EventName.SubscriptionCanceled ||
		eventType === EventName.SubscriptionPaused ||
		eventType === EventName.SubscriptionPastDue ||
		eventType === EventName.SubscriptionResumed
	) {
		if (!data.customerId) {
			return respond("missing-customer", 400);
		}
		return yield* handle({
			id: eventId,
			provider: "paddle",
			providerCustomerId: data.customerId,
			kind: eventType === EventName.SubscriptionResumed ? "resumed" : "cancelled",
		});
	}
	return yield* handle(undefined);
});

export const handlePolarWebhook = Effect.fn(function* (request: Request) {
	const id = request.headers.get("webhook-id");
	if (!id) {
		return respond("missing-event-id", 401);
	}
	const body = yield* fromPromise(() => request.text());
	const headers = Object.fromEntries(request.headers.entries());
	const verification = yield* fromPromise(() =>
		webhooks.validateEvent(body, headers, getServerVariables().POLAR_WEBHOOK_SECRET_KEY),
	).pipe(Effect.result);
	if (verification._tag === "Failure") {
		return verification.failure.cause instanceof webhooks.PolarWebhookVerificationError
			? respond("invalid-signature", 401)
			: respond("invalid-payload", 400);
	}
	const event = verification.success;
	if (event.type !== "order.paid" && event.type !== "subscription.revoked") {
		return yield* handle(undefined);
	}
	const payload = yield* Schema.decodeEffect(PolarEventData)(event.data).pipe(Effect.result);
	if (payload._tag === "Failure") {
		return respond("invalid-payload", 400);
	}
	const { items, customer, product_id } = payload.success;
	const identity = {
		id,
		provider: "polar" as const,
		providerCustomerId: customer.id,
		websiteCustomerId: customer.external_id ?? undefined,
	};
	if (event.type === "subscription.revoked") {
		return yield* handle({ ...identity, kind: "cancelled" });
	}
	if (!product_id) {
		return respond("missing-product", 400);
	}
	return yield* handle({
		...identity,
		kind: "paid",
		productId: product_id,
		priceId: items?.[0]?.product_price_id ?? undefined,
	});
});
