import {
	EventName,
	type SubscriptionNotification,
	type TransactionNotification,
} from "@paddle/paddle-node-sdk";
import { and, desc, eq, type InferSelectModel } from "drizzle-orm";
import { data } from "react-router";
import { customerPurchases, customers } from "~/drizzle/schema.server";
import {
	getDb,
	getServerVariables,
	paddleCustomDataSchema,
} from "~/lib/config.server";
import {
	getActivePurchase,
	provisionNewPurchase,
	provisionRenewal,
	revokePurchase,
} from "~/lib/provisioning.server";
import {
	getPaddleServerClient,
	getProductAndPlanTypeByPriceId,
} from "~/lib/utilities.server";
import type { Route } from "./+types/paddle-webhook";

type Customer = InferSelectModel<typeof customers> | undefined;

interface WebhookResponse {
	error?: string;
	message?: string;
}

async function findCustomerByPaddleId(
	paddleCustomerId: string,
): Promise<Customer | null> {
	return await getDb().query.customers.findFirst({
		where: eq(customers.paddleCustomerId, paddleCustomerId),
	});
}

async function findCustomerByCustomData(
	customData: unknown,
): Promise<Customer | null> {
	const parsed = paddleCustomDataSchema.safeParse(customData);
	if (!parsed.success) return null;

	return await getDb().query.customers.findFirst({
		where: eq(customers.id, parsed.data.customerId),
	});
}

async function findOrCreateCustomer(
	paddleCustomerId: string,
	customData?: unknown,
): Promise<Customer | null> {
	let customer = await findCustomerByPaddleId(paddleCustomerId);

	if (!customer && customData)
		customer = await findCustomerByCustomData(customData);

	return customer;
}

async function handleTransactionCompleted(
	paddleData: TransactionNotification,
): Promise<WebhookResponse> {
	const paddleCustomerId = paddleData.customerId;
	if (!paddleCustomerId)
		return { error: "No customer ID found in transaction completed event" };

	console.log("Received transaction completed event", { paddleCustomerId });

	const customer = await findOrCreateCustomer(
		paddleCustomerId,
		paddleData.customData,
	);
	if (!customer)
		return { error: `No customer found for customer ID: ${paddleCustomerId}` };

	const activePurchase = await getActivePurchase(customer.id);
	const priceId = paddleData.details?.lineItems?.at(0)?.priceId;
	if (!priceId) return { error: "Price ID not found" };

	const { planType, productType } = getProductAndPlanTypeByPriceId(priceId);

	if (!activePurchase) {
		console.log("Customer purchased plan:", {
			planType,
			productType,
			paddleCustomerId,
		});
		await provisionNewPurchase(
			customer,
			planType,
			productType,
			paddleCustomerId,
		);
	} else {
		console.log("Customer renewed plan:", {
			planType,
			productType,
			paddleCustomerId,
		});
		await provisionRenewal(customer, planType, productType, activePurchase);
	}

	return { message: "Transaction completed successfully" };
}

async function handleSubscriptionCancelled(
	paddleData: SubscriptionNotification,
): Promise<WebhookResponse> {
	const customerId = paddleData.customerId;
	if (!customerId) return { message: "No customer ID found" };

	const customer = await findCustomerByPaddleId(customerId);
	if (!customer) return { message: "No customer found" };

	await revokePurchase(customer);

	return { message: "Subscription cancelled successfully" };
}

async function handleSubscriptionResumed(
	paddleData: SubscriptionNotification,
): Promise<WebhookResponse> {
	const customerId = paddleData.customerId;
	if (!customerId) return { message: "No customer ID found" };

	const customer = await findCustomerByPaddleId(customerId);
	if (!customer) return { message: "No customer found" };

	const cancelledPurchase = await getDb().query.customerPurchases.findFirst({
		where: and(eq(customerPurchases.customerId, customer.id)),
		orderBy: [desc(customerPurchases.createdOn)],
	});

	if (cancelledPurchase)
		await getDb()
			.update(customerPurchases)
			.set({
				cancelledOn: null,
				updatedOn: new Date(),
			})
			.where(eq(customerPurchases.id, cancelledPurchase.id));

	return { message: "Subscription resumed successfully" };
}

export const action = async ({ request }: Route.ActionArgs) => {
	const paddleSignature = request.headers.get("paddle-signature");
	if (!paddleSignature) return data({ error: "No paddle signature" });

	const serverVariables = getServerVariables();
	const paddleClient = getPaddleServerClient();
	const requestBody = await request.text();
	const eventData = await paddleClient.webhooks.unmarshal(
		requestBody,
		serverVariables.PADDLE_WEBHOOK_SECRET_KEY,
		paddleSignature,
	);
	if (!eventData) return data({ error: "No event data found in request body" });

	const { eventType, data: paddleData } = eventData;
	console.log("Received event:", { eventType });

	let result: WebhookResponse;

	if (eventType === EventName.TransactionCompleted)
		result = await handleTransactionCompleted(paddleData);
	else if (
		eventType === EventName.SubscriptionCanceled ||
		eventType === EventName.SubscriptionPaused ||
		eventType === EventName.SubscriptionPastDue
	)
		result = await handleSubscriptionCancelled(paddleData);
	else if (eventType === EventName.SubscriptionResumed)
		result = await handleSubscriptionResumed(paddleData);
	else result = { message: "Webhook event not handled" };

	console.log("Webhook handling result:", result);

	return data(result);
};
