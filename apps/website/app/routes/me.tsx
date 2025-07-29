import {
	CheckoutEventNames,
	type Paddle,
	initializePaddle,
} from "@paddle/paddle-js";
import PurchaseCompleteEmail from "@ryot/transactional/emails/PurchaseComplete";
import {
	changeCase,
	formatDateToNaiveDate,
	getActionIntent,
} from "@ryot/ts-utils";
import { Unkey } from "@unkey/api";
import dayjs from "dayjs";
import { eq } from "drizzle-orm";
import { useEffect, useState } from "react";
import { Form, data, redirect, useLoaderData } from "react-router";
import { toast } from "sonner";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { customers } from "~/drizzle/schema.server";
import Pricing from "~/lib/components/Pricing";
import { Button } from "~/lib/components/ui/button";
import { Card } from "~/lib/components/ui/card";
import { Label } from "~/lib/components/ui/label";
import {
	type CustomData,
	GRACE_PERIOD,
	createUnkeyKey,
	db,
	getCustomerWithActivePurchase,
	prices,
	sendEmail,
	serverVariables,
	websiteAuthCookie,
} from "~/lib/config.server";
import { startUrl } from "~/lib/utils";
import type { Route } from "./+types/me";

export const loader = async ({ request }: Route.LoaderArgs) => {
	const customerDetails = await getCustomerWithActivePurchase(request);
	if (!customerDetails) return redirect(startUrl);
	return {
		prices,
		customerDetails,
		isSandbox: !!serverVariables.PADDLE_SANDBOX,
		clientToken: serverVariables.PADDLE_CLIENT_TOKEN,
		renewOn: customerDetails.renewOn
			? formatDateToNaiveDate(customerDetails.renewOn)
			: undefined,
	};
};

export const meta = () => {
	return [{ title: "My account | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const intent = getActionIntent(request);
	return await match(intent)
		.with("regenerateUnkeyKey", async () => {
			const customer = await getCustomerWithActivePurchase(request);
			if (!customer || !customer.planType) throw new Error("No customer found");
			if (!customer.unkeyKeyId) throw new Error("No unkey key found");
			const unkey = new Unkey({ rootKey: serverVariables.UNKEY_ROOT_KEY });
			await unkey.keys.update({ keyId: customer.unkeyKeyId, enabled: false });
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
					details: { __typename: "self_hosted", key: created.key },
					renewOn: customer.renewOn
						? formatDateToNaiveDate(customer.renewOn)
						: undefined,
				}),
			});
			return data({});
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
					prices={loaderData.prices}
					isLoggedIn
					onClick={(priceId) => {
						paddle?.Checkout.open({
							items: [{ priceId, quantity: 1 }],
							customer: paddleCustomerId
								? { id: paddleCustomerId }
								: { email: loaderData.customerDetails.email },
							customData: {
								customerId: loaderData.customerDetails.id,
							} as CustomData,
							settings: paddleCustomerId ? { allowLogout: false } : undefined,
						});
					}}
				/>
			)}
			<Form
				method="POST"
				action={withQuery(".", { intent: "logout" })}
				className="flex w-full items-end justify-end mt-4 md:mt-0 md:px-10 pb-6"
			>
				<Button type="submit">Sign out</Button>
			</Form>
		</>
	);
}
