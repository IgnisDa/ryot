import { EventName } from "@paddle/paddle-node-sdk";
import type { ActionFunctionArgs } from "@remix-run/node";
import { RegisterUserDocument } from "@ryot/generated/graphql/backend/graphql";
import PurchaseCompleteEmail from "@ryot/transactional/emails/PurchaseComplete";
import { Unkey } from "@unkey/api";
import dayjs from "dayjs";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { match } from "ts-pattern";
import { customers } from "~/drizzle/schema.server";
import {
	GRACE_PERIOD,
	customDataSchema,
	db,
	getPaddleServerClient,
	getProductAndPlanTypeByPriceId,
	sendEmail,
	serverGqlService,
	serverVariables,
} from "~/lib/config.server";

export const action = async ({ request }: ActionFunctionArgs) => {
	const paddleSignature = request.headers.get("paddle-signature");
	if (!paddleSignature) return Response.json({ error: "No paddle signature" });

	const paddleClient = getPaddleServerClient();
	const requestBody = await request.text();
	const eventData = paddleClient.webhooks.unmarshal(
		requestBody,
		serverVariables.PADDLE_WEBHOOK_SECRET_KEY,
		paddleSignature,
	);
	if (!eventData)
		return Response.json({ error: "No event data found in request body" });

	console.log(`Received event: ${eventData.eventType}`);

	if (eventData.eventType === EventName.TransactionCompleted) {
		const paddleCustomerId = eventData.data.customerId;
		if (!paddleCustomerId)
			return Response.json({
				error: "No customer ID found in transaction completed event",
			});
		console.log(
			`Received transaction completed event for customer id: ${paddleCustomerId}`,
		);
		let customer = await db.query.customers.findFirst({
			where: eq(customers.paddleCustomerId, paddleCustomerId),
		});
		if (!customer) {
			const parsed = customDataSchema.safeParse(eventData.data.customData);
			if (parsed.success)
				customer = await db.query.customers.findFirst({
					where: eq(customers.id, parsed.data.customerId),
				});
		}

		if (!customer)
			return Response.json({
				error: `No customer found for customer ID: ${paddleCustomerId}`,
			});

		if (!customer.planType) {
			const priceId = eventData.data.details?.lineItems[0].priceId;
			if (!priceId) return Response.json({ error: "Price ID not found" });

			const { planType, productType } = getProductAndPlanTypeByPriceId(priceId);
			console.log(
				`Customer ${paddleCustomerId} purchased ${productType} with plan type ${planType}`,
			);

			const { email, oidcIssuerId } = customer;
			const renewOn = match(planType)
				.with("lifetime", () => undefined)
				.with("yearly", () => dayjs().add(1, "year"))
				.with("monthly", () => dayjs().add(1, "month"))
				.exhaustive();
			const { ryotUserId, unkeyKeyId, data } = await match(productType)
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
						data: {
							__typename: "cloud" as const,
							auth: oidcIssuerId ? email : { username: email, password },
						},
					};
				})
				.with("self_hosted", async () => {
					const unkey = new Unkey({ rootKey: serverVariables.UNKEY_ROOT_KEY });
					const created = await unkey.keys.create({
						apiId: serverVariables.UNKEY_API_ID,
						name: email,
						meta: renewOn
							? {
									expiry: renewOn
										.add(GRACE_PERIOD, "days")
										.format("YYYY-MM-DD"),
								}
							: undefined,
					});
					if (created.error) throw new Error(created.error.message);
					return {
						ryotUserId: null,
						unkeyKeyId: created.result.keyId,
						data: {
							__typename: "self_hosted" as const,
							key: created.result.key,
						},
					};
				})
				.exhaustive();
			const renewal = renewOn ? renewOn.format("YYYY-MM-DD") : undefined;
			await sendEmail(
				customer.email,
				PurchaseCompleteEmail.subject,
				PurchaseCompleteEmail({ planType, renewOn: renewal, data }),
			);
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
		}
	}

	return Response.json({ message: "Webhook ran successfully" });
};
