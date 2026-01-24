import type {
	EntitySchemaSlug,
	ImportRunId,
	SandboxProviderId,
} from "@ryot/contract/schema/brands";
import { PluginSlug, UserId } from "@ryot/contract/schema/brands";

import { adminHeaders } from "./admin";
import { getBackendClient } from "./contract-client";

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

export const getMediaPopulationGateResult = (input: {
	itemCount?: number;
	runId: ImportRunId;
	executionIds: ReadonlyArray<string>;
}) =>
	getBackendClient().call(
		(client) =>
			client.testSupport.getWorkflowLoadGateResult({
				payload: { ...input, itemCount: input.itemCount ?? 1_001 },
			}),
		adminHeaders,
	);

export const sampleOperationalPressure = (executionIds: ReadonlyArray<string>) =>
	getBackendClient().call(
		(client) => client.testSupport.sampleOperationalPressure({ payload: { executionIds } }),
		adminHeaders,
	);
