import {
	CheckoutEventNames,
	type Paddle,
	initializePaddle,
} from "@paddle/paddle-js";
import PurchaseCompleteEmail from "@ryot/transactional/emails/PurchaseComplete";
import { changeCase, getActionIntent } from "@ryot/ts-utils";
import { Unkey } from "@unkey/api";
import dayjs from "dayjs";
import { eq } from "drizzle-orm";
import { useEffect, useState } from "react";
import { Form, data, redirect, useFetcher, useLoaderData } from "react-router";
import { toast } from "sonner";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { customers } from "~/drizzle/schema.server";
import Pricing from "~/lib/components/Pricing";
import { Button } from "~/lib/components/ui/button";
import { Card } from "~/lib/components/ui/card";
import { Label } from "~/lib/components/ui/label";
import {
	GRACE_PERIOD,
	type PaddleCustomData,
	db,
	prices,
	serverVariables,
	websiteAuthCookie,
} from "~/lib/config.server";
import { startUrl } from "~/lib/constants";
import {
	createUnkeyKey,
	getCustomerWithActivePurchase,
	getPaddleServerClient,
	sendEmail,
} from "~/lib/utilities.server";
import type { Route } from "./+types/me";

export const loader = async ({ request }: Route.LoaderArgs) => {
	const customerDetails = await getCustomerWithActivePurchase(request);
	if (!customerDetails) return redirect(startUrl);
	return {
		prices,
		customerDetails,
		renewOn: customerDetails.renewOn,
		isSandbox: !!serverVariables.PADDLE_SANDBOX,
		clientToken: serverVariables.PADDLE_CLIENT_TOKEN,
	};
};

export const meta = () => {
	return [{ title: "My account | Ryot" }];
};

const getAllSubscriptionsForCustomer = async (customerId: string) => {
	const paddleClient = getPaddleServerClient();
	const allSubscriptions = [];
	const subscriptionsQuery = paddleClient.subscriptions.list({
		customerId: [customerId],
	});

	for await (const subscription of subscriptionsQuery) {
		allSubscriptions.push(subscription);
	}

	return allSubscriptions;
};

export const action = async ({ request }: Route.ActionArgs) => {
	const intent = getActionIntent(request);
	const customer = await getCustomerWithActivePurchase(request);
	return await match(intent)
		.with("regenerateUnkeyKey", async () => {
			if (!customer || !customer.planType) throw new Error("No customer found");
			if (!customer.unkeyKeyId) throw new Error("No unkey key found");
			const unkey = new Unkey({ rootKey: serverVariables.UNKEY_ROOT_KEY });
			await unkey.keys.updateKey({
				enabled: false,
				keyId: customer.unkeyKeyId,
			});
			const renewOnDayjs = customer.renewOn
				? dayjs(customer.renewOn)
				: undefined;
			const created = await createUnkeyKey(
				customer,
				renewOnDayjs ? renewOnDayjs.add(GRACE_PERIOD, "days") : undefined,
			);
			await db
				.update(customers)
				.set({ unkeyKeyId: created.keyId })
				.where(eq(customers.id, customer.id));
			await sendEmail({
				recipient: customer.email,
				subject: PurchaseCompleteEmail.subject,
				element: PurchaseCompleteEmail({
					planType: customer.planType,
					renewOn: customer.renewOn || undefined,
					details: { __typename: "self_hosted", key: created.key },
				}),
			});
			return data({});
		})
		.with("cancelSubscription", async () => {
			if (!customer?.paddleCustomerId)
				throw new Error("No Paddle customer ID found");
			const paddleClient = getPaddleServerClient();

			const subscriptionsResponse = await getAllSubscriptionsForCustomer(
				customer.paddleCustomerId,
			);

			const activeSubscription = subscriptionsResponse.find((sub) =>
				["active", "trialing"].includes(sub.status),
			);

			if (!activeSubscription) throw new Error("No active subscription found");

			console.log("Active Subscription:", {
				customerId: customer.id,
				activeSubscription: activeSubscription.id,
			});

			await paddleClient.subscriptions.cancel(activeSubscription.id, {
				effectiveFrom: "immediately",
			});

			await new Promise((resolve) => setTimeout(resolve, 2000));

			return data({
				success: true,
				message: "Subscription cancelled successfully",
			});
		})
		.with("logout", async () => {
			const cookies = await websiteAuthCookie.serialize("", {
				expires: new Date(0),
			});
			return data({}, { headers: { "set-cookie": cookies } });
		})
		.run();
};

export default function Index() {
	const loaderData = useLoaderData<typeof loader>();
	const [paddle, setPaddle] = useState<Paddle>();
	const fetcher = useFetcher();

	const isCancelLoading = fetcher.state !== "idle";
	const paddleCustomerId = loaderData.customerDetails.paddleCustomerId;

	useEffect(() => {
		if (!paddle)
			initializePaddle({
				token: loaderData.clientToken,
				environment: loaderData.isSandbox ? "sandbox" : undefined,
			}).then((paddleInstance) => {
				if (paddleInstance) {
					paddleInstance.Update({
						eventCallback: (data) => {
							if (data.name === CheckoutEventNames.CHECKOUT_COMPLETED) {
								paddleInstance.Checkout.close();
								toast.loading(
									"Purchase successful. Your order will be shipped shortly.",
								);
								setTimeout(() => window.location.reload(), 10000);
							}
						},
					});
					setPaddle(paddleInstance);
				}
			});
	}, []);

	return (
		<>
			{!loaderData.customerDetails.hasCancelled &&
			loaderData.customerDetails.planType &&
			loaderData.customerDetails.productType ? (
				<Card className="w-full max-w-md p-6 grid gap-6 m-auto mt-40">
					<div className="grid grid-cols-2 gap-4">
						<div className="col-span-2">
							<Label>Email</Label>
							<p className="text-muted-foreground">
								{loaderData.customerDetails.email}
							</p>
						</div>
						<div>
							<Label>Product Type</Label>
							<p className="text-muted-foreground">
								{changeCase(loaderData.customerDetails.productType)}
							</p>
						</div>
						<div>
							<Label>Plan Type</Label>
							<p className="text-muted-foreground">
								{changeCase(loaderData.customerDetails.planType)}
							</p>
						</div>
						{loaderData.renewOn ? (
							<div>
								<Label>Renewal Status</Label>
								<p className="text-muted-foreground">
									Renews on {loaderData.renewOn}
								</p>
							</div>
						) : null}
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
								<div className="flex items-center justify-between">
									<Label>Key ID</Label>
									<Form
										method="POST"
										action={withQuery(".", { intent: "regenerateUnkeyKey" })}
									>
										<button
											type="submit"
											className="text-xs underline text-right"
											onClick={(e) => {
												const yes = confirm(
													"Are you sure you want to regenerate the unkey key? All old unkey keys will be invalidated.",
												);
												if (!yes) e.preventDefault();
											}}
										>
											Regenerate
										</button>
									</Form>
								</div>
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
					isLoggedIn
					prices={loaderData.prices}
					onClick={(priceId) => {
						paddle?.Checkout.open({
							items: [{ priceId, quantity: 1 }],
							customer: paddleCustomerId
								? { id: paddleCustomerId }
								: { email: loaderData.customerDetails.email },
							customData: {
								customerId: loaderData.customerDetails.id,
							} as PaddleCustomData,
							settings: paddleCustomerId ? { allowLogout: false } : undefined,
						});
					}}
				/>
			)}
			<div className="mt-4 md:px-10 flex gap-4 justify-end items-center w-full">
				{!loaderData.customerDetails.hasCancelled &&
					!(["free", "lifetime", null] as unknown[]).includes(
						loaderData.customerDetails.planType,
					) && (
						<fetcher.Form
							method="POST"
							className="pb-6"
							action={withQuery(".", { intent: "cancelSubscription" })}
							onSubmit={(e) => {
								const yes = confirm(
									"Are you sure you want to cancel your subscription? You will lose access to the pro features immediately.",
								);
								if (!yes) e.preventDefault();
							}}
						>
							<Button variant="outline" type="submit">
								{isCancelLoading ? "Cancelling..." : "Cancel Subscription"}
							</Button>
						</fetcher.Form>
					)}
				<Form
					method="POST"
					className="pb-6"
					action={withQuery(".", { intent: "logout" })}
				>
					<Button type="submit">Sign out</Button>
				</Form>
			</div>
		</>
	);
}
