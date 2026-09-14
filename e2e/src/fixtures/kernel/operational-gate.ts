import type { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { adminHeaders } from "./admin";
import { getApiClient } from "./contract-client";

export const getMediaPopulationGateResult = (input: {
	itemCount?: number;
	runId: ImportRunId;
	executionIds: ReadonlyArray<string>;
}) =>
	getApiClient().call(
		(client) =>
			client.testSupport.getWorkflowLoadGateResult({
				payload: { ...input, itemCount: input.itemCount ?? 1_001 },
			}),
		adminHeaders(),
	);

export const sampleSandboxRuntime = Effect.suspend(() =>
	getApiClient().call(
		(client) => client.testSupport.sampleSandboxRuntime({ query: {} }),
		adminHeaders(),
	),
);

export const sampleOperationalPressure = (executionIds: ReadonlyArray<string>) =>
	getApiClient().call(
		(client) => client.testSupport.sampleOperationalPressure({ payload: { executionIds } }),
		adminHeaders(),
	);
