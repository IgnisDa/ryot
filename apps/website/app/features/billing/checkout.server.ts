import { Effect, Option, Stream } from "effect";
import { redirect } from "react-router";

import { PlanTypes, ProductTypes } from "~/drizzle/schema.server";
import { findPolarProductId, getPolarClient, getServerVariables } from "~/server/config.server";
import { fromPromise, WebsiteFailure } from "~/server/effect.server";

import { setCancellation, setPurchaseInProgress } from "./checkout-status.server";
import { getPaddleServerClient } from "./providers.server";
import type { Customer } from "./provisioning.server";

export const beginPolarCheckout = Effect.fn(function* (customer: Customer, request: Request) {
	if (customer.paymentProvider !== "polar") {
		return yield* new WebsiteFailure({ cause: "Customer is not on Polar" });
	}
	const form = yield* fromPromise(() => request.formData());
	const productType = ProductTypes.parse(form.get("productType"));
	const planType = PlanTypes.parse(form.get("planType"));
	const productId = findPolarProductId(productType, planType);
	if (!productId) {
		return yield* new WebsiteFailure({ cause: "Polar product not found" });
	}
	const checkout = yield* fromPromise(() =>
		getPolarClient().checkouts.create({
			products: [productId],
			customer_email: customer.email,
			external_customer_id: customer.id,
			success_url: `${getServerVariables().FRONTEND_URL}/me`,
		}),
	);
	setPurchaseInProgress(customer.id);
	return redirect(checkout.url);
});

const findActiveSubscription = Effect.fn(function* (
	subscriptions: AsyncIterable<{ id: string; status: string }>,
) {
	const active = yield* Stream.fromAsyncIterable(
		subscriptions,
		(cause) => new WebsiteFailure({ cause }),
	).pipe(
		Stream.filter(({ status }) => status === "active" || status === "trialing"),
		Stream.runHead,
	);
	if (Option.isNone(active)) {
		return yield* new WebsiteFailure({ cause: "No active subscription found" });
	}
	return active.value;
});

export const cancelSubscription = Effect.fn(function* (customer: Customer) {
	if (customer.paymentProvider === "polar") {
		const polar = getPolarClient();
		const subscription = yield* findActiveSubscription(
			polar.subscriptions.iterList({ external_customer_id: customer.id }),
		);
		yield* fromPromise(() => polar.subscriptions.revoke(subscription.id));
	} else {
		const { paddleCustomerId } = customer;
		if (!paddleCustomerId) {
			return yield* new WebsiteFailure({ cause: "No Paddle customer ID found" });
		}
		const paddle = getPaddleServerClient();
		const subscription = yield* findActiveSubscription(
			paddle.subscriptions.list({ customerId: [paddleCustomerId] }),
		);
		yield* fromPromise(() =>
			paddle.subscriptions.cancel(subscription.id, { effectiveFrom: "immediately" }),
		);
	}
	setCancellation(customer.id);
	return undefined;
});
