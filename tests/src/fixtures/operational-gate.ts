import type {
	EntitySchemaSlug,
	ImportRunId,
	SandboxProviderId,
} from "@ryot/contract/schema/brands";
import { UserId } from "@ryot/contract/schema/brands";

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
			client.testSupport.startMediaPopulationGate({
				payload: { ...input, executingUserId: UserId.make(input.executingUserId) },
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
			client.testSupport.getMediaPopulationGateResult({
				payload: { ...input, itemCount: input.itemCount ?? 1_001 },
			}),
		adminHeaders,
	);

export const sampleOperationalPressure = (executionIds: ReadonlyArray<string>) =>
	getBackendClient().call(
		(client) => client.testSupport.sampleOperationalPressure({ payload: { executionIds } }),
		adminHeaders,
	);
