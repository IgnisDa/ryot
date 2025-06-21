import { EventName } from "@paddle/paddle-node-sdk";
import {
	RegisterUserDocument,
	UpdateUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import PurchaseCompleteEmail from "@ryot/transactional/emails/PurchaseComplete";
import { formatDateToNaiveDate } from "@ryot/ts-utils";
import { Unkey } from "@unkey/api";
import dayjs from "dayjs";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { match } from "ts-pattern";
import { customers, type TPlanTypes } from "~/drizzle/schema.server";
import {
	createUnkeyKey,
	customDataSchema,
	db,
	GRACE_PERIOD,
	getPaddleServerClient,
	getProductAndPlanTypeByPriceId,
	sendEmail,
	serverGqlService,
	serverVariables,
} from "~/lib/config.server";
import type { Route } from "./+types/paddle-webhook";

const getRenewOnFromPlanType = (planType: TPlanTypes) =>
	match(planType)
		.with("free", "lifetime", () => undefined)
		.with("yearly", () => dayjs().add(1, "year"))
		.with("monthly", () => dayjs().add(1, "month"))
		.exhaustive();

export const action = async ({ request }: Route.ActionArgs) => {
	const paddleSignature = request.headers.get("paddle-signature");
	if (!paddleSignature) return Response.json({ error: "No paddle signature" });

	const paddleClient = getPaddleServerClient();
	const requestBody = await request.text();
	const eventData = await paddleClient.webhooks.unmarshal(
		requestBody,
		serverVariables.PADDLE_WEBHOOK_SECRET_KEY,
		paddleSignature,
	);
	if (!eventData)
		return Response.json({ error: "No event data found in request body" });

	const { eventType, data } = eventData;

	console.log("Received event:", { eventType });

	if (eventType === EventName.TransactionCompleted) {
		const paddleCustomerId = data.customerId;
		if (!paddleCustomerId)
			return Response.json({
				error: "No customer ID found in transaction completed event",
			});
		console.log("Received transaction completed event", { paddleCustomerId });
		let customer = await db.query.customers.findFirst({
			where: eq(customers.paddleCustomerId, paddleCustomerId),
		});
		if (!customer) {
			const parsed = customDataSchema.safeParse(data.customData);
			if (parsed.success)
				customer = await db.query.customers.findFirst({
					where: eq(customers.id, parsed.data.customerId),
				});
		}

		if (!customer)
			return Response.json({
				error: `No customer found for customer ID: ${paddleCustomerId}`,
			});

		const unkey = new Unkey({ rootKey: serverVariables.UNKEY_ROOT_KEY });
		if (!customer.planType) {
			const priceId = data.details?.lineItems[0].priceId;
			if (!priceId) return Response.json({ error: "Price ID not found" });

			const { planType, productType } = getProductAndPlanTypeByPriceId(priceId);
			console.log("Customer purchased plan:", {
				paddleCustomerId,
				productType,
				planType,
			});

			const { email, oidcIssuerId } = customer;
			const renewOn = getRenewOnFromPlanType(planType);
			const { ryotUserId, unkeyKeyId, details } = await match(productType)
				.with("cloud", async () => {
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
							__typename: "cloud" as const,
							auth: oidcIssuerId ? email : { username: email, password },
						},
					};
				})
				.with("self_hosted", async () => {
					const created = await createUnkeyKey(
						customer,
						renewOn ? renewOn.add(GRACE_PERIOD, "days") : undefined,
					);
					return {
						ryotUserId: null,
						unkeyKeyId: created.keyId,
						details: {
							key: created.key,
							__typename: "self_hosted" as const,
						},
					};
				})
				.exhaustive();
			const renewal = renewOn ? formatDateToNaiveDate(renewOn) : undefined;
			await sendEmail({
				recipient: customer.email,
				subject: PurchaseCompleteEmail.subject,
				element: PurchaseCompleteEmail({ planType, renewOn: renewal, details }),
			});
			await db
				.update(customers)
				.set({
					planType,
					ryotUserId,
					unkeyKeyId,
					productType,
					renewOn: renewal,
					paddleCustomerId,
				})
				.where(eq(customers.id, customer.id));
		} else {
			const renewal = getRenewOnFromPlanType(customer.planType);
			const renewOn = renewal ? formatDateToNaiveDate(renewal) : undefined;
			console.log("Updating customer with renewOn", { renewOn });
			await db
				.update(customers)
				.set({ renewOn, hasCancelled: null })
				.where(eq(customers.id, customer.id));
			if (customer.ryotUserId)
				await serverGqlService.request(UpdateUserDocument, {
					input: {
						isDisabled: false,
						userId: customer.ryotUserId,
						adminAccessToken: serverVariables.SERVER_ADMIN_ACCESS_TOKEN,
					},
				});
			if (customer.unkeyKeyId)
				await unkey.keys.update({
					keyId: customer.unkeyKeyId,
					meta: renewal
						? {
								expiry: formatDateToNaiveDate(
									renewal.add(GRACE_PERIOD, "days"),
								),
							}
						: undefined,
				});
		}
	}

	if (
		eventType === EventName.SubscriptionCanceled ||
		eventType === EventName.SubscriptionPaused ||
		eventType === EventName.SubscriptionPastDue
	) {
		const customerId = data.customerId;
		const customer = await db.query.customers.findFirst({
			where: eq(customers.paddleCustomerId, customerId),
		});
		if (!customer) return Response.json({ message: "No customer found" });
		await db
			.update(customers)
			.set({ hasCancelled: true })
			.where(eq(customers.id, customer.id));
		if (customer.ryotUserId)
			await serverGqlService.request(UpdateUserDocument, {
				input: {
					isDisabled: true,
					userId: customer.ryotUserId,
					adminAccessToken: serverVariables.SERVER_ADMIN_ACCESS_TOKEN,
				},
			});
	}

	if (eventType === EventName.SubscriptionResumed) {
		const customerId = data.customerId;
		const customer = await db.query.customers.findFirst({
			where: eq(customers.paddleCustomerId, customerId),
		});
		if (!customer) return Response.json({ message: "No customer found" });
		await db
			.update(customers)
			.set({ hasCancelled: null })
			.where(eq(customers.id, customer.id));
	}

	return Response.json({ message: "Webhook ran successfully" });
};
