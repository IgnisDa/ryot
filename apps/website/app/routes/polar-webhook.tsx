import { webhooks } from "@polar-sh/sdk/2026-04";
import { data } from "react-router";
import { match } from "ts-pattern";
import {
	revokeCancellation,
	revokePurchaseInProgress,
} from "~/lib/caches.server";
import { getPolarWebhookSecret } from "~/lib/config.server";
import {
	findCustomerById,
	findCustomerByPolarId,
	findCustomerWithFallback,
} from "~/lib/customer-lookup.server";
import {
	handlePurchaseOrRenewal,
	revokePurchase,
} from "~/lib/provisioning.server";
import { getProductAndPlanTypeByPolarIds } from "~/lib/utilities.server";
import type { Route } from "./+types/polar-webhook";

async function findCustomer(
	polarCustomerId: string | undefined,
	externalCustomerId: string | undefined,
) {
	return findCustomerWithFallback(
		polarCustomerId,
		findCustomerByPolarId,
		externalCustomerId,
		findCustomerById,
	);
}

type PolarWebhookEvent = Awaited<ReturnType<typeof webhooks.validateEvent>>;

async function handleOrderPaid(
	event: PolarWebhookEvent,
): Promise<{ error?: string; message?: string }> {
	if (event.type !== "order.paid") return { error: "Invalid event type" };

	const { data: order } = event;
	const polarCustomerId = order.customer.id;
	const externalCustomerId = order.customer.external_id || undefined;

	console.log("Received order.paid event", {
		polarCustomerId,
		externalCustomerId,
	});

	const customer = await findCustomer(polarCustomerId, externalCustomerId);
	if (!customer)
		return {
			error: `No customer found for Polar customer ID: ${polarCustomerId}`,
		};

	const productId = order.product_id;
	if (!productId) return { error: "Product ID not found in order" };

	const priceId = order.items[0]?.product_price_id;
	const planAndProduct = getProductAndPlanTypeByPolarIds(productId, priceId);
	if (!planAndProduct)
		return { error: `No matching product found for product ID: ${productId}` };

	const { planType, productType } = planAndProduct;

	await handlePurchaseOrRenewal(
		customer,
		planType,
		productType,
		polarCustomerId,
		{
			paymentProvider: "polar",
			providerProductId: productId,
			providerPriceId: priceId ?? undefined,
		},
	);
	revokePurchaseInProgress(customer.id);

	return { message: "Order processed successfully" };
}

async function handleSubscriptionRevoked(
	event: PolarWebhookEvent,
): Promise<{ error?: string; message?: string }> {
	if (event.type !== "subscription.revoked")
		return { error: "Invalid event type" };

	const { data: subscription } = event;
	const polarCustomerId = subscription.customer.id;
	const externalCustomerId = subscription.customer.external_id || undefined;

	console.log("Received subscription.revoked event", {
		polarCustomerId,
		externalCustomerId,
	});

	const customer = await findCustomer(polarCustomerId, externalCustomerId);
	if (!customer) return { error: "No customer found" };

	await revokePurchase(customer);
	revokeCancellation(customer.id);

	return { message: "Subscription revoked successfully" };
}

export const action = async ({ request }: Route.ActionArgs) => {
	const body = await request.text();
	const headers: Record<string, string> = {};
	const webhookSecret = getPolarWebhookSecret();
	request.headers.forEach((value, key) => {
		headers[key] = value;
	});

	let event: PolarWebhookEvent;
	try {
		event = await webhooks.validateEvent(body, headers, webhookSecret);
	} catch (error) {
		console.error("Polar webhook validation failed:", error);
		const isInvalidSignature =
			error instanceof webhooks.PolarWebhookVerificationError;
		return data(
			{
				error: isInvalidSignature
					? "Invalid webhook signature"
					: "Invalid webhook payload",
			},
			{ status: isInvalidSignature ? 401 : 400 },
		);
	}

	console.log("Received Polar webhook event:", { type: event.type });

	let result: { error?: string; message?: string };
	try {
		result = await match(event.type)
			.with("order.paid", () => handleOrderPaid(event))
			.with("subscription.revoked", () => handleSubscriptionRevoked(event))
			.otherwise(() => ({ message: "Webhook event not handled" }));
	} catch (error) {
		console.error("Polar webhook handling failed:", error);
		return data(
			{ error: "Polar webhook could not be processed" },
			{ status: 503 },
		);
	}

	console.log("Webhook handling result:", result);

	const status = result.error?.startsWith("No matching product found")
		? 503
		: result.error === "Product ID not found in order"
			? 400
			: 200;
	return data(result, { status });
};
