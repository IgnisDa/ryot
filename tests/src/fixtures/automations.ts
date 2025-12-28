import { UserId } from "@ryot/contract/schema/brands";

import { adminHeaders } from "./admin";
import { getBackendClient } from "./contract-client";

export async function installBuiltinNotificationSubscription(userId: string, signalSlug: string) {
	return getBackendClient().run(
		(c) =>
			c.testSupport.installBuiltinNotificationSubscription({
				payload: { signalSchemaSlug: signalSlug, userId: UserId.make(userId) },
			}),
		adminHeaders,
	);
}
