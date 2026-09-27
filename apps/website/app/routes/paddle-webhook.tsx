import {
	EventName,
	type SubscriptionNotification,
	type TransactionNotification,
} from "@paddle/paddle-node-sdk";
import { desc, eq, type InferSelectModel } from "drizzle-orm";
import { Effect } from "effect";
import type { HttpClient } from "effect/http";
import { data } from "react-router";

import { customerPurchase, type customer } from "~/drizzle/schema.server";
import { revokeCancellation, revokePurchaseInProgress } from "~/lib/caches.server";
import { getDb, getServerVariables } from "~/lib/config.server";
import {
	findCustomerByPaddleCustomData,
	findCustomerByPaddleId,
} from "~/lib/customer-lookup.server";
import { fromPromise, type WebsiteFailure } from "~/lib/effect.server";
import { handlePurchaseOrRenewal, revokePurchase } from "~/lib/provisioning.server";
import { runPromise } from "~/lib/runtime.server";
import { getPaddleServerClient, getProductAndPlanTypeByPriceId } from "~/lib/utilities.server";

import type { Route } from "./+types/paddle-webhook";

type Customer = InferSelectModel<typeof customer> | undefined;

interface WebhookResponse {
	error?: string;
	message?: string;
}

function findOrCreateCustomer(
	paddleCustomerId: string,
	customData?: unknown,
): Effect.Effect<Customer | null, WebsiteFailure> {
	return Effect.gen(function* () {
		let customer = yield* findCustomerByPaddleId(paddleCustomerId);

		if (!customer && customData) {
			customer = yield* findCustomerByPaddleCustomData(customData);
		}

		return customer ?? null;
	});
}

function handleTransactionCompleted(
	paddleData: TransactionNotification,
): Effect.Effect<WebhookResponse, WebsiteFailure, HttpClient.HttpClient> {
	return Effect.gen(function* () {
		const paddleCustomerId = paddleData.customerId;
		if (!paddleCustomerId) {
			return { error: "No customer ID found in transaction completed event" };
		}

		yield* Effect.log("Received transaction completed event", { paddleCustomerId });

		const customer = yield* findOrCreateCustomer(paddleCustomerId, paddleData.customData);
		if (!customer) {
			return { error: `No customer found for customer ID: ${paddleCustomerId}` };
		}

		if (!paddleData.details) {
			return { error: "No transaction details found" };
		}

		const priceId = paddleData.details.lineItems.at(0)?.priceId;
		if (!priceId) {
			return { error: "Price ID not found" };
		}

		const { planType, productType } = getProductAndPlanTypeByPriceId(priceId);

		yield* handlePurchaseOrRenewal(customer, planType, productType, paddleCustomerId, {
			providerPriceId: priceId,
			paymentProvider: "paddle",
		});
		revokePurchaseInProgress(customer.id);

		return { message: "Transaction completed successfully" };
	});
}

function handleSubscriptionCancelled(
	paddleData: SubscriptionNotification,
): Effect.Effect<WebhookResponse, WebsiteFailure, HttpClient.HttpClient> {
	return Effect.gen(function* () {
		const customerId = paddleData.customerId;
		if (!customerId) {
			return { message: "No customer ID found" };
		}

		const customer = yield* findCustomerByPaddleId(customerId);
		if (!customer) {
			return { message: "No customer found" };
		}

		yield* revokePurchase(customer);
		revokeCancellation(customer.id);

		return { message: "Subscription cancelled successfully" };
	});
}

function handleSubscriptionResumed(
	paddleData: SubscriptionNotification,
): Effect.Effect<WebhookResponse, WebsiteFailure> {
	return Effect.gen(function* () {
		const customerId = paddleData.customerId;
		if (!customerId) {
			return { message: "No customer ID found" };
		}

		const customer = yield* findCustomerByPaddleId(customerId);
		if (!customer) {
			return { message: "No customer found" };
		}

		const cancelledPurchase = yield* fromPromise(() =>
			getDb().query.customerPurchase.findFirst({
				orderBy: [desc(customerPurchase.createdOn)],
				where: eq(customerPurchase.customerId, customer.id),
			}),
		);

		if (cancelledPurchase) {
			yield* fromPromise(() =>
				getDb()
					.update(customerPurchase)
					.set({ cancelledOn: null, updatedOn: new Date() })
					.where(eq(customerPurchase.id, cancelledPurchase.id)),
			);
		}

		return { message: "Subscription resumed successfully" };
	});
}

export const action = ({ request }: Route.ActionArgs) =>
	runPromise(
		Effect.gen(function* () {
			const paddleSignature = request.headers.get("paddle-signature");
			if (!paddleSignature) {
				return data({ error: "No paddle signature" }, { status: 401 });
			}

			const serverVariables = getServerVariables();
			const paddleClient = getPaddleServerClient();
			const requestBody = yield* fromPromise(() => request.text());
			const validated = yield* fromPromise(() =>
				paddleClient.webhooks.unmarshal(
					requestBody,
					serverVariables.PADDLE_WEBHOOK_SECRET_KEY,
					paddleSignature,
				),
			).pipe(
				Effect.map((event) => ({ event })),
				Effect.catch((failure) =>
					Effect.gen(function* () {
						const error = failure.cause;
						yield* Effect.logError("Paddle webhook validation failed:", error);
						const isInvalidSignature =
							error instanceof Error &&
							error.message.toLowerCase().includes("signature verification failed");
						return {
							response: data(
								{
									error: isInvalidSignature
										? "Invalid paddle signature"
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
			const eventData = validated.event;
			const { eventType, data: paddleData } = eventData;
			yield* Effect.log("Received event:", { eventType });

			const handled = yield* Effect.gen(function* () {
				if (eventType === EventName.TransactionCompleted) {
					return yield* handleTransactionCompleted(paddleData);
				} else if (
					eventType === EventName.SubscriptionCanceled ||
					eventType === EventName.SubscriptionPaused ||
					eventType === EventName.SubscriptionPastDue
				) {
					return yield* handleSubscriptionCancelled(paddleData);
				} else if (eventType === EventName.SubscriptionResumed) {
					return yield* handleSubscriptionResumed(paddleData);
				}
				return { message: "Webhook event not handled" };
			}).pipe(
				Effect.map((result) => ({ result })),
				Effect.catchCause((cause) =>
					Effect.gen(function* () {
						yield* Effect.logError("Paddle webhook handling failed:", cause);
						return {
							response: data({ error: "Paddle webhook could not be processed" }, { status: 503 }),
						};
					}),
				),
			);
			if ("response" in handled) {
				return handled.response;
			}
			const result: WebhookResponse = handled.result;

			yield* Effect.log("Webhook handling result:", result);

			return data(result, { status: result.error === "Price ID not found" ? 400 : 200 });
		}),
	);
