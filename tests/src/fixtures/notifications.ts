import { NotificationChannelId } from "@ryot/contract/schema/brands";

import { startFakeHttpServer } from "../test-support/fake-http-server";
import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";

type CreateNotificationChannelBody = ContractPayload<"notifications", "createChannel">;
type UpdateNotificationChannelBody = ContractPayload<"notifications", "updateChannel">;

export function createNotificationChannel(client: Client, payload: CreateNotificationChannelBody) {
	return client.run((c) => c.notifications.createChannel({ payload }));
}

export function listNotificationChannels(client: Client) {
	return client.run((c) => c.notifications.listChannels());
}

export function updateNotificationChannel(
	client: Client,
	channelId: string,
	payload: UpdateNotificationChannelBody,
) {
	return client.run((c) =>
		c.notifications.updateChannel({
			payload,
			path: { channelId: NotificationChannelId.make(channelId) },
		}),
	);
}

export function deleteNotificationChannel(client: Client, channelId: string) {
	return client.run((c) =>
		c.notifications.deleteChannel({
			path: { channelId: NotificationChannelId.make(channelId) },
		}),
	);
}

export function testNotificationChannels(client: Client) {
	return client.run((c) => c.notifications.testChannels());
}

export function startFakeAppriseServer() {
	return startFakeHttpServer((url) =>
		url.pathname.endsWith("/fail")
			? new Response("failed", { status: 500 })
			: Response.json({ ok: true }),
	);
}
