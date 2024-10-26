import { EventName } from "@paddle/paddle-node-sdk";
import { logger } from "@remix-pwa/sw";
import type { ActionFunctionArgs } from "@remix-run/node";
import { eq } from "drizzle-orm";
import invariant from "tiny-invariant";
import { customers } from "~/drizzle/schema.server";
import {
	db,
	getPaddleServerClient,
	serverVariables,
} from "~/lib/config.server";

export const action = async ({ request }: ActionFunctionArgs) => {
	const paddleSignature = request.headers.get("paddle-signature");
	invariant(paddleSignature, "No paddle signature found");
	const paddleClient = getPaddleServerClient();
	const requestBody = await request.text();
	const eventData = paddleClient.webhooks.unmarshal(
		requestBody,
		serverVariables.PADDLE_WEBHOOK_SECRET_KEY,
		paddleSignature,
	);
	if (!eventData)
		return Response.json({ error: "No event data found in request body" });

	if (eventData.eventType === EventName.TransactionCompleted) {
		const customerId = eventData.data.customerId;
		if (!customerId)
			return Response.json({
				error: "No customer ID found in transaction completed event",
			});
		logger.debug(
			`Received transaction completed event for customer id: ${customerId}`,
		);
		const customer = await db.query.customers.findFirst({
			where: eq(customers.paddleCustomerId, customerId),
		});
		console.log(customer);
	}

	return Response.json({ message: "Webhook ran successfully" });
};
