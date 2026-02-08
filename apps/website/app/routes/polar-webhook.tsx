import { validateEvent } from "@polar-sh/sdk/webhooks";
import { data } from "react-router";
import { match } from "ts-pattern";
import type { TPlanTypes, TProductTypes } from "~/drizzle/schema.server";
import {
	revokeCancellation,
	revokePurchaseInProgress,
} from "~/lib/caches.server";
import { getPolarProducts, getPolarWebhookSecret } from "~/lib/config.server";
import {
	findCustomerById,
	findCustomerByPolarId,
	findCustomerWithFallback,
} from "~/lib/customer-lookup.server";
import {
	handlePurchaseOrRenewal,
	revokePurchase,
} from "~/lib/provisioning.server";
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

function findPlanAndProductType(
	productId: string,
): { planType: TPlanTypes; productType: TProductTypes } | null {
	const products = getPolarProducts();

	for (const product of products) {
		const matchingPrice = product.prices.find((p) => p.productId === productId);
		if (matchingPrice)
			return { productType: product.type, planType: matchingPrice.name };
	}

	return null;
}

async function handleOrderPaid(
	event: ReturnType<typeof validateEvent>,
): Promise<{ error?: string; message?: string }> {
	if (event.type !== "order.paid") return { error: "Invalid event type" };

	const { data: order } = event;
	const polarCustomerId = order.customer.id;
	const externalCustomerId = order.customer.externalId || undefined;

	console.log("Received order.paid event", {
		polarCustomerId,
		externalCustomerId,
	});

	const customer = await findCustomer(polarCustomerId, externalCustomerId);
	if (!customer)
		return {
			error: `No customer found for Polar customer ID: ${polarCustomerId}`,
		};

	const productId = order.productId;
	if (!productId) return { error: "Product ID not found in order" };

	const planAndProduct = findPlanAndProductType(productId);
	if (!planAndProduct)
		return { error: `No matching product found for product ID: ${productId}` };

	const { planType, productType } = planAndProduct;

	await handlePurchaseOrRenewal(
		customer,
		planType,
		productType,
		polarCustomerId,
	);
	revokePurchaseInProgress(customer.id);

	return { message: "Order processed successfully" };
}

async function handleSubscriptionRevoked(
	event: ReturnType<typeof validateEvent>,
): Promise<{ error?: string; message?: string }> {
	if (event.type !== "subscription.revoked")
		return { error: "Invalid event type" };

	const { data: subscription } = event;
	const polarCustomerId = subscription.customer.id;
	const externalCustomerId = subscription.customer.externalId || undefined;

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

	let event: ReturnType<typeof validateEvent>;
	try {
		event = validateEvent(body, headers, webhookSecret);
	} catch (error) {
		console.error("Webhook validation failed:", error);
		return data({ error: "Invalid webhook signature" }, { status: 401 });
	}

	console.log("Received Polar webhook event:", { type: event.type });

	const result = await match(event.type)
		.with("order.paid", () => handleOrderPaid(event))
		.with("subscription.revoked", () => handleSubscriptionRevoked(event))
		.otherwise(() => ({ message: "Webhook event not handled" }));

	console.log("Webhook handling result:", result);

	return data(result);
};
