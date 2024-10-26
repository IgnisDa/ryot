import type { ActionFunctionArgs } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { customers, PlanTypes } from "~/drizzle/schema.server";
import { db, getPaddleServerClient } from "~/lib/config.server";

export const action = async (_args: ActionFunctionArgs) => {
	const paddleClient = getPaddleServerClient();
	const subscriptionsRequest = paddleClient.subscriptions.list({
		status: ["canceled", "past_due", "paused"],
	});
	do {
		const details = await subscriptionsRequest.next();
		for (const subscription of details) {
			const customer = await db.query.customers.findFirst({
				where: eq(customers.paddleCustomerId, subscription.customerId),
			});
			if (!customer) continue;
			if (customer.planType === PlanTypes.Values.lifetime) continue;
			console.log(customer);
		}
	} while (subscriptionsRequest.hasMore);
	return Response.json({ totalChecked: 0 });
};
