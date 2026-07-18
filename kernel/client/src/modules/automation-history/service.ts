import { createRyotMutation, createRyotQuery } from "@ryot-app/client-sdk/react";
import type {
	AutomationHistoryDetail,
	AutomationHistoryFilters,
	AutomationHistoryPage,
	AutomationHistoryRetryResult,
} from "@ryot-app/contract/modules/automations/history-schemas";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { AutomationHistoryApi } from "#/api/automation-history";
import type { KernelHostServices } from "#/host-services";

export type AutomationHistoryPageResult = {
	readonly cursor: string | undefined;
	readonly page: AutomationHistoryPage;
};

export const automationHistoryPageQuery = createRyotQuery<
	AutomationHistoryFilters,
	AutomationHistoryPageResult,
	KernelHostServices
>(
	async ({ input, signal, hostServices }) => ({
		cursor: input.cursor,
		page: await hostServices.runtime.runPromise(
			Effect.flatMap(AutomationHistoryApi, (api) =>
				api.listRuns(hostServices.scope, { query: input }),
			),
			{ signal },
		),
	}),
	{ cancelOnUnmount: true },
);

export const automationHistoryDetailQuery = createRyotQuery<
	string,
	AutomationHistoryDetail,
	KernelHostServices
>(({ input, signal, hostServices }) =>
	hostServices.runtime.runPromise(
		Effect.flatMap(AutomationHistoryApi, (api) =>
			api.getRun(hostServices.scope, { params: { runId: AutomationRunId.make(input) } }),
		),
		{ signal },
	),
);

export const retryAutomationRunMutation = createRyotMutation<
	{ readonly runId: string; readonly expectedAttemptCount: number },
	AutomationHistoryRetryResult,
	KernelHostServices
>(async ({ input, signal, hostServices }) =>
	hostServices.runtime.runPromise(
		Effect.flatMap(AutomationHistoryApi, (api) =>
			api.retryRun(hostServices.scope, {
				params: { runId: AutomationRunId.make(input.runId) },
				payload: { expectedAttemptCount: input.expectedAttemptCount },
			}),
		),
		{ signal },
	),
);
