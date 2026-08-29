import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { Effect } from "effect";
import { data } from "react-router";
import { match } from "ts-pattern";

import { revokeCancellation, revokePurchaseInProgress } from "~/lib/caches.server";
import { getPolarWebhookSecret } from "~/lib/config.server";
import {
	findCustomerById,
	findCustomerByPolarId,
	findCustomerWithFallback,
} from "~/lib/customer-lookup.server";
import { fromPromise, WebsiteFailure } from "~/lib/effect.server";
import { handlePurchaseOrRenewal, revokePurchase } from "~/lib/provisioning.server";
import { getProductAndPlanTypeByPolarIds } from "~/lib/utilities.server";

import type { Route } from "./+types/polar-webhook";

function findCustomer(polarCustomerId: string | undefined, externalCustomerId: string | undefined) {
	return findCustomerWithFallback(
		polarCustomerId,
		findCustomerByPolarId,
		externalCustomerId,
		findCustomerById,
	);
}

function handleOrderPaid(
	event: ReturnType<typeof validateEvent>,
): Effect.Effect<{ error?: string; message?: string }, WebsiteFailure> {
	return Effect.gen(function* () {
		if (event.type !== "order.paid") {
			return { error: "Invalid event type" };
		}

		const { data: order } = event;
		const polarCustomerId = order.customer.id;
		const externalCustomerId = order.customer.externalId ?? undefined;

		yield* Effect.log("Received order.paid event", { polarCustomerId, externalCustomerId });

		const customer = yield* findCustomer(polarCustomerId, externalCustomerId);
		if (!customer) {
			return { error: `No customer found for Polar customer ID: ${polarCustomerId}` };
		}

		const productId = order.productId;
		if (!productId) {
			return { error: "Product ID not found in order" };
		}

		const priceId = order.items[0]?.productPriceId;
		const planAndProduct = getProductAndPlanTypeByPolarIds(productId, priceId);
		if (!planAndProduct) {
			return { error: `No matching product found for product ID: ${productId}` };
		}

		const { planType, productType } = planAndProduct;

		yield* handlePurchaseOrRenewal(customer, planType, productType, polarCustomerId, {
			paymentProvider: "polar",
			providerProductId: productId,
			providerPriceId: priceId ?? undefined,
		});
		revokePurchaseInProgress(customer.id);

		return { message: "Order processed successfully" };
	});
}

function handleSubscriptionRevoked(
	event: ReturnType<typeof validateEvent>,
): Effect.Effect<{ error?: string; message?: string }, WebsiteFailure> {
	return Effect.gen(function* () {
		if (event.type !== "subscription.revoked") {
			return { error: "Invalid event type" };
		}

		const { data: subscription } = event;
		const polarCustomerId = subscription.customer.id;
		const externalCustomerId = subscription.customer.externalId ?? undefined;

		yield* Effect.log("Received subscription.revoked event", {
			polarCustomerId,
			externalCustomerId,
		});

		const customer = yield* findCustomer(polarCustomerId, externalCustomerId);
		if (!customer) {
			return { error: "No customer found" };
		}

		yield* revokePurchase(customer);
		revokeCancellation(customer.id);

		return { message: "Subscription revoked successfully" };
	});
}

export const action = ({ request }: Route.ActionArgs) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const body = yield* fromPromise(() => request.text());
			const headers: Record<string, string> = {};
			const webhookSecret = getPolarWebhookSecret();
			request.headers.forEach((value, key) => {
				headers[key] = value;
			});

			const validated = yield* Effect.try({
				catch: (cause) => new WebsiteFailure({ cause }),
				try: () => validateEvent(body, headers, webhookSecret),
			}).pipe(
				Effect.map((event) => ({ event })),
				Effect.catch((failure) =>
					Effect.gen(function* () {
						const error = failure.cause;
						yield* Effect.logError("Polar webhook validation failed:", error);
						const isInvalidSignature = error instanceof WebhookVerificationError;
						return {
							response: data(
								{
									error: isInvalidSignature
										? "Invalid webhook signature"
										: "Invalid webhook payload",
								},
								{ status: isInvalidSignature ? 401 : 400 },
							),
						};
					}),
				),
			);
			if ("response" in validated) {
				return validated.response;
			}
			const event = validated.event;

			yield* Effect.log("Received Polar webhook event:", { type: event.type });

			const handled = yield* match(event.type)
				.with("order.paid", () => handleOrderPaid(event))
				.with("subscription.revoked", () => handleSubscriptionRevoked(event))
				.otherwise(() => Effect.succeed({ message: "Webhook event not handled" }))
				.pipe(
					Effect.map((result) => ({ result })),
					Effect.catchCause((cause) =>
						Effect.gen(function* () {
							yield* Effect.logError("Polar webhook handling failed:", cause);
							return {
								response: data({ error: "Polar webhook could not be processed" }, { status: 503 }),
							};
						}),
					),
				);
			if ("response" in handled) {
				return handled.response;
			}
			const result: { error?: string; message?: string } = handled.result;

			yield* Effect.log("Webhook handling result:", result);

			let status = 200;
			if (result.error?.startsWith("No matching product found")) {
				status = 503;
			} else if (result.error === "Product ID not found in order") {
				status = 400;
			}
			return data(result, { status });
		}),
	);
