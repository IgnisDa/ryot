import type { ImportRunId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { adminHeaders } from "./admin";
import { getBackendClient } from "./contract-client";

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

export const sampleSandboxRuntime = Effect.suspend(() =>
	getBackendClient().call(
		(client) => client.testSupport.sampleSandboxRuntime({ query: {} }),
		adminHeaders,
	),
);

export const sampleOperationalPressure = (executionIds: ReadonlyArray<string>) =>
	getBackendClient().call(
		(client) => client.testSupport.sampleOperationalPressure({ payload: { executionIds } }),
		adminHeaders,
	);
