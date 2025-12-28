import { NotificationPlatformId } from "@ryot/contract/schema/brands";

import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";

type CreateNotificationPlatformBody = ContractPayload<"notifications", "createPlatform">;
type UpdateNotificationPlatformBody = ContractPayload<"notifications", "updatePlatform">;

export function createNotificationPlatform(
	client: Client,
	payload: CreateNotificationPlatformBody,
) {
	return client.run((c) => c.notifications.createPlatform({ payload }));
}

export function listNotificationPlatforms(client: Client) {
	return client.run((c) => c.notifications.listPlatforms());
}

export function updateNotificationPlatform(
	client: Client,
	platformId: string,
	payload: UpdateNotificationPlatformBody,
) {
	return client.run((c) =>
		c.notifications.updatePlatform({
			payload,
			path: { platformId: NotificationPlatformId.make(platformId) },
		}),
	);
}

export function deleteNotificationPlatform(client: Client, platformId: string) {
	return client.run((c) =>
		c.notifications.deletePlatform({
			path: { platformId: NotificationPlatformId.make(platformId) },
		}),
	);
}

export function testNotificationPlatforms(client: Client) {
	return client.run((c) => c.notifications.testPlatforms());
}
