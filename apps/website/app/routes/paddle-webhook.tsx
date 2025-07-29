import {
	EventName,
	type SubscriptionNotification,
	type TransactionNotification,
} from "@paddle/paddle-node-sdk";
import {
	RegisterUserDocument,
	UpdateUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import PurchaseCompleteEmail, {
	type PurchaseCompleteEmailProps,
} from "@ryot/transactional/emails/PurchaseComplete";
import { formatDateToNaiveDate } from "@ryot/ts-utils";
import { Unkey } from "@unkey/api";
import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { data } from "react-router";
import { match } from "ts-pattern";
import {
	customerPurchases,
	customers,
	type TPlanTypes,
	type TProductTypes,
} from "~/drizzle/schema.server";
import {
	GRACE_PERIOD,
	calculateRenewalDate,
	createUnkeyKey,
	customDataSchema,
	db,
	getPaddleServerClient,
	getProductAndPlanTypeByPriceId,
	sendEmail,
	serverGqlService,
	serverVariables,
} from "~/lib/config.server";
import type { Route } from "./+types/paddle-webhook";

type Customer = Awaited<ReturnType<typeof db.query.customers.findFirst>>;

interface WebhookResponse {
	error?: string;
	message?: string;
}

async function findCustomerByPaddleId(
	paddleCustomerId: string,
): Promise<Customer | null> {
	return await db.query.customers.findFirst({
		where: eq(customers.paddleCustomerId, paddleCustomerId),
	});
}

async function findCustomerByCustomData(
	customData: unknown,
): Promise<Customer | null> {
	const parsed = customDataSchema.safeParse(customData);
	if (!parsed.success) return null;

	return await db.query.customers.findFirst({
		where: eq(customers.id, parsed.data.customerId),
	});
}

async function findOrCreateCustomer(
	paddleCustomerId: string,
	customData?: unknown,
): Promise<Customer | null> {
	let customer = await findCustomerByPaddleId(paddleCustomerId);

	if (!customer && customData) {
		customer = await findCustomerByCustomData(customData);
	}

	return customer;
}

async function getActivePurchase(customerId: string) {
	return await db.query.customerPurchases.findFirst({
		where: and(
			eq(customerPurchases.customerId, customerId),
			isNull(customerPurchases.cancelledOn),
		),
	});
}

async function handleCloudPurchase(customer: NonNullable<Customer>): Promise<{
	ryotUserId: string;
	unkeyKeyId: null;
	details: PurchaseCompleteEmailProps["details"];
}> {
	const { email, oidcIssuerId } = customer;

	if (customer.ryotUserId) {
		await serverGqlService.request(UpdateUserDocument, {
			input: {
				isDisabled: false,
				userId: customer.ryotUserId,
				adminAccessToken: serverVariables.SERVER_ADMIN_ACCESS_TOKEN,
			},
		});
		return {
			ryotUserId: customer.ryotUserId,
			unkeyKeyId: null,
			details: {
				__typename: "cloud",
				auth: oidcIssuerId ? email : "User reactivated",
			},
		};
	}

	const password = nanoid(10);
	const { registerUser } = await serverGqlService.request(
		RegisterUserDocument,
		{
			input: {
				adminAccessToken: serverVariables.SERVER_ADMIN_ACCESS_TOKEN,
				data: oidcIssuerId
					? { oidc: { email: email, issuerId: oidcIssuerId } }
					: { password: { username: email, password: password } },
			},
		},
	);
	if (registerUser.__typename === "RegisterError") {
		console.error(registerUser);
		throw new Error("Failed to register user");
	}
	return {
		ryotUserId: registerUser.id,
		unkeyKeyId: null,
		details: {
			__typename: "cloud",
			auth: oidcIssuerId ? email : { username: email, password },
		},
	};
}

async function handleSelfHostedPurchase(
	customer: NonNullable<Customer>,
	planType: TPlanTypes,
): Promise<{
	ryotUserId: null;
	unkeyKeyId: string;
	details: PurchaseCompleteEmailProps["details"];
}> {
	const unkey = new Unkey({ rootKey: serverVariables.UNKEY_ROOT_KEY });
	const renewalDate = calculateRenewalDate(planType);

	if (customer.unkeyKeyId) {
		await unkey.keys.update({
			enabled: true,
			keyId: customer.unkeyKeyId,
			meta: renewalDate
				? {
						expiry: formatDateToNaiveDate(
							renewalDate.add(GRACE_PERIOD, "days"),
						),
					}
				: undefined,
		});
		return {
			ryotUserId: null,
			unkeyKeyId: customer.unkeyKeyId,
			details: {
				__typename: "self_hosted",
				key: "API key reactivated with new expiry",
			},
		};
	}

	const created = await createUnkeyKey(
		customer,
		renewalDate ? renewalDate.add(GRACE_PERIOD, "days") : undefined,
	);
	return {
		ryotUserId: null,
		unkeyKeyId: created.keyId,
		details: {
			__typename: "self_hosted",
			key: created.key,
		},
	};
}

async function processNewPurchase(
	customer: NonNullable<Customer>,
	planType: TPlanTypes,
	productType: TProductTypes,
	paddleCustomerId: string,
) {
	const { ryotUserId, unkeyKeyId, details } = await match(productType)
		.with("cloud", () => handleCloudPurchase(customer))
		.with("self_hosted", () => handleSelfHostedPurchase(customer, planType))
		.exhaustive();

	const renewalDate = calculateRenewalDate(planType);
	const renewOn = renewalDate ? formatDateToNaiveDate(renewalDate) : undefined;

	await sendEmail({
		recipient: customer.email,
		subject: PurchaseCompleteEmail.subject,
		element: PurchaseCompleteEmail({
			planType,
			renewOn,
			details,
		}),
	});

	await db.insert(customerPurchases).values({
		planType,
		productType,
		customerId: customer.id,
	});

	const updateData: {
		ryotUserId?: string | null;
		unkeyKeyId?: string | null;
		paddleCustomerId?: string | null;
	} = {};

	if (ryotUserId && ryotUserId !== customer.ryotUserId) {
		updateData.ryotUserId = ryotUserId;
	}
	if (unkeyKeyId && unkeyKeyId !== customer.unkeyKeyId) {
		updateData.unkeyKeyId = unkeyKeyId;
	}
	if (paddleCustomerId && paddleCustomerId !== customer.paddleCustomerId) {
		updateData.paddleCustomerId = paddleCustomerId;
	}

	if (Object.keys(updateData).length > 0) {
		await db
			.update(customers)
			.set(updateData)
			.where(eq(customers.id, customer.id));
	}
}

async function processRenewal(
	customer: NonNullable<Customer>,
	planType: TPlanTypes,
	productType: TProductTypes,
	activePurchase: NonNullable<Awaited<ReturnType<typeof getActivePurchase>>>,
) {
	await db
		.update(customerPurchases)
		.set({
			planType,
			productType,
			updatedOn: new Date(),
		})
		.where(eq(customerPurchases.id, activePurchase.id));

	if (customer.ryotUserId) {
		await serverGqlService.request(UpdateUserDocument, {
			input: {
				isDisabled: false,
				userId: customer.ryotUserId,
				adminAccessToken: serverVariables.SERVER_ADMIN_ACCESS_TOKEN,
			},
		});
	}

	if (customer.unkeyKeyId) {
		const unkey = new Unkey({ rootKey: serverVariables.UNKEY_ROOT_KEY });
		const renewal = calculateRenewalDate(planType);

		await unkey.keys.update({
			enabled: true,
			keyId: customer.unkeyKeyId,
			meta: renewal
				? {
						expiry: formatDateToNaiveDate(renewal.add(GRACE_PERIOD, "days")),
					}
				: undefined,
		});
	}
}

async function handleTransactionCompleted(
	paddleData: TransactionNotification,
): Promise<WebhookResponse> {
	const paddleCustomerId = paddleData.customerId;
	if (!paddleCustomerId) {
		return { error: "No customer ID found in transaction completed event" };
	}

	console.log("Received transaction completed event", { paddleCustomerId });

	const customer = await findOrCreateCustomer(
		paddleCustomerId,
		paddleData.customData,
	);
	if (!customer) {
		return { error: `No customer found for customer ID: ${paddleCustomerId}` };
	}

	const activePurchase = await getActivePurchase(customer.id);
	const priceId = paddleData.details?.lineItems?.at(0)?.priceId;
	if (!priceId) return { error: "Price ID not found" };

	const { planType, productType } = getProductAndPlanTypeByPriceId(priceId);

	if (!activePurchase) {
		console.log("Customer purchased plan:", {
			paddleCustomerId,
			productType,
			planType,
		});
		await processNewPurchase(customer, planType, productType, paddleCustomerId);
	} else {
		console.log("Customer renewed plan:", {
			paddleCustomerId,
			productType,
			planType,
		});
		await processRenewal(customer, planType, productType, activePurchase);
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

	await db
		.update(customerPurchases)
		.set({
			cancelledOn: new Date(),
			updatedOn: new Date(),
		})
		.where(
			and(
				eq(customerPurchases.customerId, customer.id),
				isNull(customerPurchases.cancelledOn),
			),
		);

	if (customer.ryotUserId) {
		await serverGqlService.request(UpdateUserDocument, {
			input: {
				isDisabled: true,
				userId: customer.ryotUserId,
				adminAccessToken: serverVariables.SERVER_ADMIN_ACCESS_TOKEN,
			},
		});
	}

	return { message: "Subscription cancelled successfully" };
}

async function handleSubscriptionResumed(
	paddleData: SubscriptionNotification,
): Promise<WebhookResponse> {
	const customerId = paddleData.customerId;
	if (!customerId) return { message: "No customer ID found" };

	const customer = await findCustomerByPaddleId(customerId);
	if (!customer) return { message: "No customer found" };

	const cancelledPurchase = await db.query.customerPurchases.findFirst({
		where: and(eq(customerPurchases.customerId, customer.id)),
		orderBy: [desc(customerPurchases.createdOn)],
	});

	if (cancelledPurchase) {
		await db
			.update(customerPurchases)
			.set({
				cancelledOn: null,
				updatedOn: new Date(),
			})
			.where(eq(customerPurchases.id, cancelledPurchase.id));
	}

	return { message: "Subscription resumed successfully" };
}

export const action = async ({ request }: Route.ActionArgs) => {
	const paddleSignature = request.headers.get("paddle-signature");
	if (!paddleSignature) return data({ error: "No paddle signature" });

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

	if (eventType === EventName.TransactionCompleted) {
		result = await handleTransactionCompleted(paddleData);
	} else if (
		eventType === EventName.SubscriptionCanceled ||
		eventType === EventName.SubscriptionPaused ||
		eventType === EventName.SubscriptionPastDue
	) {
		result = await handleSubscriptionCancelled(paddleData);
	} else if (eventType === EventName.SubscriptionResumed) {
		result = await handleSubscriptionResumed(paddleData);
	} else {
		result = { message: "Webhook event not handled" };
	}

	return data(result);
};
