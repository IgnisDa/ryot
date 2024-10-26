import type { ActionFunctionArgs } from "@remix-run/node";
import { and, isNotNull, ne } from "drizzle-orm";
import { customers } from "~/drizzle/schema.server";
import { db } from "~/lib/config.server";

export const action = async (_args: ActionFunctionArgs) => {
	const toCheck = await db.query.customers.findMany({
		where: and(
			isNotNull(customers.paddleCustomerId),
			ne(customers.planType, "lifetime"),
		),
	});
	console.log(toCheck);
	return Response.json({ totalChecked: toCheck.length });
};
