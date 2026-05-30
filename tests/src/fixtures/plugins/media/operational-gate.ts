import type { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { PluginSlug, UserId } from "@ryot/contract/schema/brands";

import { adminHeaders } from "~/fixtures/kernel/admin";
import { getBackendClient } from "~/fixtures/kernel/contract-client";

export const startMediaPopulationGate = (input: {
	itemCount: number;
	executingUserId: string;
	identifierPrefix: string;
	providerId: SandboxProviderId;
	entitySchemaSlug: EntitySchemaSlug;
}) =>
	getBackendClient().call(
		(client) =>
			client.testSupport.startWorkflowLoadGate({
				payload: {
					...input,
					source: "netflix",
					pluginSlug: PluginSlug.make("media"),
					workflowSlug: "media-import-population",
					executingUserId: UserId.make(input.executingUserId),
				},
			}),
		adminHeaders,
	);
