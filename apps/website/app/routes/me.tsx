import {
	CheckoutEventNames,
	type Paddle,
	initializePaddle,
} from "@paddle/paddle-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, redirect, useLoaderData, useSubmit } from "@remix-run/react";
import { RegisterUserDocument } from "@ryot/generated/graphql/backend/graphql";
import PurchaseCompleteEmail from "@ryot/transactional/emails/PurchaseComplete";
import { changeCase, getActionIntent } from "@ryot/ts-utils";
import { Unkey } from "@unkey/api";
import dayjs from "dayjs";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { $path } from "remix-routes";
import { match } from "ts-pattern";
import { withFragment, withQuery } from "ufo";
import { customers } from "~/drizzle/schema.server";
import Pricing from "~/lib/components/Pricing";
import { Button } from "~/lib/components/ui/button";
import { Card } from "~/lib/components/ui/card";
import { Label } from "~/lib/components/ui/label";
import {
	GRACE_PERIOD,
	authCookie,
	db,
	getPaddleServerClient,
	getProductAndPlanTypeByPriceId,
	getUserIdFromCookie,
	prices,
	sendEmail,
	serverGqlService,
	serverVariables,
} from "~/lib/config.server";

const redirectToStartHere = () =>
	redirect(withFragment($path("/"), "start-here"));

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const userId = await getUserIdFromCookie(request);
	const isLoggedIn = !!userId;
	if (!isLoggedIn) return redirectToStartHere();
	const customerDetails = await db.query.customers.findFirst({
		where: eq(customers.id, userId),
		columns: {
			email: true,
			renewOn: true,
			planType: true,
			productType: true,
			unkeyKeyId: true,
			ryotUserId: true,
		},
	});
	if (!customerDetails) return redirectToStartHere();
	return {
		prices,
		customerDetails,
		isSandbox: !!serverVariables.PADDLE_SANDBOX,
		clientToken: serverVariables.PADDLE_CLIENT_TOKEN,
	};
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const intent = getActionIntent(request);
	return await match(intent)
		.with("logout", async () => {
			const cookies = await authCookie.serialize("", { expires: new Date(0) });
			return Response.json({}, { headers: { "set-cookie": cookies } });
		})
		.with("processPurchase", async () => {
			const userId = await getUserIdFromCookie(request);
			if (!userId)
				throw new Error("You must be logged in to buy a subscription");
			const { transactionId }: { transactionId: string } = await request.json();
			const paddleClient = getPaddleServerClient();
			const transaction = await paddleClient.transactions.get(transactionId);
			const priceId = transaction.details?.lineItems[0].priceId;
			if (!priceId) throw new Error("Price ID not found");
			const paddleCustomerId = transaction.customerId;
			if (!paddleCustomerId) throw new Error("Paddle customer ID not found");
			const customer = await db.query.customers.findFirst({
				where: eq(customers.id, userId),
			});
			if (!customer) throw new Error("Customer not found");
			const { email, oidcIssuerId } = customer;
			const { planType, productType } = getProductAndPlanTypeByPriceId(priceId);
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
				.where(eq(customers.id, userId));
			return Response.json({});
		})
		.run();
};

export default function Index() {
	const loaderData = useLoaderData<typeof loader>();
	const submit = useSubmit();
	const [paddle, setPaddle] = useState<Paddle>();

	useEffect(() => {
		initializePaddle({
			token: loaderData.clientToken,
			environment: loaderData.isSandbox ? "sandbox" : undefined,
			eventCallback: (data) => {
				if (data.name === CheckoutEventNames.CHECKOUT_COMPLETED) {
					paddle?.Checkout.close();
					const transactionId = data.data?.transaction_id;
					if (!transactionId) throw new Error("Transaction ID not found");
					submit(
						{ transactionId },
						{
							method: "POST",
							encType: "application/json",
							action: withQuery(".", { intent: "processPurchase" }),
						},
					);
				}
			},
		}).then((paddleInstance) => {
			if (paddleInstance) setPaddle(paddleInstance);
		});
	}, []);

	return (
		<>
			{loaderData.customerDetails.planType &&
			loaderData.customerDetails.productType ? (
				<Card className="w-full max-w-md p-6 grid gap-6 m-auto mt-40">
					<div className="grid grid-cols-2 gap-4">
						<div className="col-span-2">
							<Label>Email</Label>
							<p className="text-muted-foreground">
								{loaderData.customerDetails.email}
							</p>
						</div>
						{loaderData.customerDetails.renewOn ? (
							<div>
								<Label>Renewal Status</Label>
								<p className="text-muted-foreground">
									Renews on {loaderData.customerDetails.renewOn}
								</p>
							</div>
						) : null}
						<div>
							<Label>Plan Type</Label>
							<p className="text-muted-foreground">
								{changeCase(loaderData.customerDetails.planType)}
							</p>
						</div>
						<div>
							<Label>Product Type</Label>
							<p className="text-muted-foreground">
								{changeCase(loaderData.customerDetails.productType)}
							</p>
						</div>
						{loaderData.customerDetails.ryotUserId ? (
							<div>
								<Label>User ID</Label>
								<p className="text-muted-foreground">
									{loaderData.customerDetails.ryotUserId}
								</p>
							</div>
						) : null}
						{loaderData.customerDetails.unkeyKeyId ? (
							<div className="col-span-2">
								<Label>Key ID</Label>
								<p className="text-muted-foreground">
									{loaderData.customerDetails.unkeyKeyId}
								</p>
								<p className="text-xs text-gray-500">
									(This is the key ID; the pro key has been sent to your email)
								</p>
							</div>
						) : null}
					</div>
				</Card>
			) : (
				<Pricing
					prices={loaderData.prices}
					isLoggedIn
					onClick={(priceId) => {
						paddle?.Checkout.open({
							items: [{ priceId, quantity: 1 }],
							customer: { email: loaderData.customerDetails.email },
						});
					}}
				/>
			)}
			<Form
				method="POST"
				action={withQuery(".", { intent: "logout" })}
				className="flex w-full items-end justify-end px-4 md:px-10 pb-6"
			>
				<Button type="submit">Sign out</Button>
			</Form>
		</>
	);
}
