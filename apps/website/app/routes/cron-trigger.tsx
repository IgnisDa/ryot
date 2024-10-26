import type { ActionFunctionArgs } from "@remix-run/node";
import { and, isNotNull, ne } from "drizzle-orm";
import { customers } from "~/drizzle/schema.server";
import { db, getPaddleServerClient } from "~/lib/config.server";

export const action = async (_args: ActionFunctionArgs) => {
	const toCheck = await db.query.customers.findMany({
		where: and(
			isNotNull(customers.paddleCustomerId),
			ne(customers.planType, "lifetime"),
		),
	});
	const paddleClient = getPaddleServerClient();
	for (const customer of toCheck) {
		if (!customer.paddleCustomerId) continue;
		const details = await paddleClient.subscriptions
			.list({
				status: ["active", "trialing"],
				customerId: [customer.paddleCustomerId],
			})
			.next();
		console.log(details);
	}
	return Response.json({ totalChecked: toCheck.length });
};
