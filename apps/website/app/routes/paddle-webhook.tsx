import { TransactionCompletedEvent } from "@paddle/paddle-node-sdk";
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
	if (!eventData) return Response.json({});
	if (eventData.data instanceof TransactionCompletedEvent) {
		const customerId = eventData.data.data.customerId;
		if (!customerId) return Response.json({});
		const customer = await db.query.customers.findFirst({
			where: eq(customers.paddleCustomerId, eventData.data.data.customerId),
		});
		console.log(customer);
	}
	return Response.json({});
};
