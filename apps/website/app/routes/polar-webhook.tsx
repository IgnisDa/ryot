import { validateEvent } from "@polar-sh/sdk/webhooks";
import { eq } from "drizzle-orm";
import { data } from "react-router";
import { match } from "ts-pattern";
import {
	customers,
	type TPlanTypes,
	type TProductTypes,
} from "~/drizzle/schema.server";
import {
	getDb,
	getPolarProducts,
	getPolarWebhookSecret,
} from "~/lib/config.server";
import {
	getActivePurchase,
	provisionNewPurchase,
	provisionRenewal,
	revokePurchase,
} from "~/lib/provisioning.server";
import type { Route } from "./+types/polar-webhook";

async function findCustomerByPolarId(polarCustomerId: string) {
	return await getDb().query.customers.findFirst({
		where: eq(customers.polarCustomerId, polarCustomerId),
	});
}

async function findCustomerByExternalId(externalId: string) {
	return await getDb().query.customers.findFirst({
		where: eq(customers.id, externalId),
	});
}

async function findCustomer(
	polarCustomerId: string | undefined,
	externalCustomerId: string | undefined,
) {
	if (polarCustomerId) {
		const customer = await findCustomerByPolarId(polarCustomerId);
		if (customer) return customer;
	}

	if (externalCustomerId)
		return await findCustomerByExternalId(externalCustomerId);

	return null;
}

function findPlanAndProductType(
	productId: string,
): { planType: TPlanTypes; productType: TProductTypes } | null {
	const products = getPolarProducts();
	if (!products) return null;

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
	const activePurchase = await getActivePurchase(customer.id);

	if (!activePurchase) {
		console.log("Customer purchased plan:", {
			planType,
			productType,
			polarCustomerId,
		});
		await provisionNewPurchase(
			customer,
			planType,
			productType,
			polarCustomerId,
		);
	} else {
		console.log("Customer renewed plan:", {
			planType,
			productType,
			polarCustomerId,
		});
		await provisionRenewal(customer, planType, productType, activePurchase);
	}

	if (polarCustomerId && polarCustomerId !== customer.polarCustomerId)
		await getDb()
			.update(customers)
			.set({ polarCustomerId })
			.where(eq(customers.id, customer.id));

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
	if (!customer) return { message: "No customer found" };

	await revokePurchase(customer);

	return { message: "Subscription revoked successfully" };
}

export const action = async ({ request }: Route.ActionArgs) => {
	const webhookSecret = getPolarWebhookSecret();
	if (!webhookSecret)
		return data(
			{ error: "Polar webhook secret not configured" },
			{ status: 500 },
		);

	const body = await request.text();
	const headers: Record<string, string> = {};
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

	return data(result);
};
