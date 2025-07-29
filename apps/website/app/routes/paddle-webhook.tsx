import { EventName } from "@paddle/paddle-node-sdk";
import {
	RegisterUserDocument,
	UpdateUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import PurchaseCompleteEmail from "@ryot/transactional/emails/PurchaseComplete";
import { formatDateToNaiveDate } from "@ryot/ts-utils";
import { Unkey } from "@unkey/api";
import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { data } from "react-router";
import { match } from "ts-pattern";
import { customerPurchases, customers } from "~/drizzle/schema.server";
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

	if (eventType === EventName.TransactionCompleted) {
		const paddleCustomerId = paddleData.customerId;
		if (!paddleCustomerId)
			return data({
				error: "No customer ID found in transaction completed event",
			});
		console.log("Received transaction completed event", { paddleCustomerId });
		let customer = await db.query.customers.findFirst({
			where: eq(customers.paddleCustomerId, paddleCustomerId),
		});
		if (!customer) {
			const parsed = customDataSchema.safeParse(paddleData.customData);
			if (parsed.success)
				customer = await db.query.customers.findFirst({
					where: eq(customers.id, parsed.data.customerId),
				});
		}

		if (!customer)
			return data({
				error: `No customer found for customer ID: ${paddleCustomerId}`,
			});

		const unkey = new Unkey({ rootKey: serverVariables.UNKEY_ROOT_KEY });

		const activePurchase = await db.query.customerPurchases.findFirst({
			where: and(
				eq(customerPurchases.customerId, customer.id),
				isNull(customerPurchases.cancelledOn),
			),
		});

		if (!activePurchase) {
			const priceId = paddleData.details?.lineItems.at(0)?.priceId;
			if (!priceId) return data({ error: "Price ID not found" });

			const { planType, productType } = getProductAndPlanTypeByPriceId(priceId);
			console.log("Customer purchased plan:", {
				paddleCustomerId,
				productType,
				planType,
			});

			const { email, oidcIssuerId } = customer;
			const { ryotUserId, unkeyKeyId, details } = await match(productType)
				.with("cloud", async () => {
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
								__typename: "cloud" as const,
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
							__typename: "cloud" as const,
							auth: oidcIssuerId ? email : { username: email, password },
						},
					};
				})
				.with("self_hosted", async () => {
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
								key: "API key reactivated with new expiry",
								__typename: "self_hosted" as const,
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
							key: created.key,
							__typename: "self_hosted" as const,
						},
					};
				})
				.exhaustive();
			const renewalDate = calculateRenewalDate(planType);
			const renewOn = renewalDate
				? formatDateToNaiveDate(renewalDate)
				: undefined;

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
		} else {
			const priceId = paddleData.details?.lineItems[0].priceId;
			if (!priceId) return data({ error: "Price ID not found" });

			const { planType, productType } = getProductAndPlanTypeByPriceId(priceId);
			console.log("Customer renewed plan:", {
				paddleCustomerId,
				productType,
				planType,
			});

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
				const renewal = calculateRenewalDate(planType);

				await unkey.keys.update({
					enabled: true,
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
	}

	if (
		eventType === EventName.SubscriptionCanceled ||
		eventType === EventName.SubscriptionPaused ||
		eventType === EventName.SubscriptionPastDue
	) {
		const customerId = paddleData.customerId;
		const customer = await db.query.customers.findFirst({
			where: eq(customers.paddleCustomerId, customerId),
		});
		if (!customer) return data({ message: "No customer found" });

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
		const customerId = paddleData.customerId;
		const customer = await db.query.customers.findFirst({
			where: eq(customers.paddleCustomerId, customerId),
		});
		if (!customer) return data({ message: "No customer found" });

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
	}

	return data({ message: "Webhook ran successfully" });
};
