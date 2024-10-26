import {
	CheckoutEventNames,
	type Paddle,
	initializePaddle,
} from "@paddle/paddle-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, redirect, useLoaderData } from "@remix-run/react";
import { changeCase, getActionIntent } from "@ryot/ts-utils";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import Pricing from "~/lib/components/Pricing";
import { Button } from "~/lib/components/ui/button";
import { Card } from "~/lib/components/ui/card";
import { Label } from "~/lib/components/ui/label";
import {
	type CustomData,
	getCustomerFromCookie,
	prices,
	serverVariables,
	websiteAuthCookie,
} from "~/lib/config.server";
import { startUrl } from "~/lib/utils";

const redirectToStartHere = () => redirect(startUrl);

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const customerDetails = await getCustomerFromCookie(request);
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
			const cookies = await websiteAuthCookie.serialize("", {
				expires: new Date(0),
			});
			return Response.json({}, { headers: { "set-cookie": cookies } });
		})
		.run();
};

export default function Index() {
	const loaderData = useLoaderData<typeof loader>();
	const [paddle, setPaddle] = useState<Paddle>();

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
							customData: {
								customerId: loaderData.customerDetails.id,
							} as CustomData,
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
