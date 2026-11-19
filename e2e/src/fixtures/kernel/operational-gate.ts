import type { ImportRunId } from "@ryot-app/contract/schema/brands";

import { getSharedHarnessTarget } from "~/support/harness-target";

import { getApiClient } from "./contract-client";

export const getMediaPopulationGateResult = (
	input: { itemCount?: number; runId: ImportRunId; executionIds: ReadonlyArray<string> },
	target = getSharedHarnessTarget(),
) =>
	getApiClient(target).adminCall((client) =>
		client.testSupport.getWorkflowLoadGateResult({
			payload: { ...input, itemCount: input.itemCount ?? 1_001 },
		}),
	);

export const sampleOperationalPressure = (
	executionIds: ReadonlyArray<string>,
	target = getSharedHarnessTarget(),
) =>
	getApiClient(target).adminCall((client) =>
		client.testSupport.sampleOperationalPressure({ payload: { executionIds } }),
	);
