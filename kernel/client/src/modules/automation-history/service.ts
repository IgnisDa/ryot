import type { AutomationHistoryRetryResult } from "@ryot-app/contract/modules/automations/history-schemas";
import { AUTOMATION_HISTORY_LIMITS } from "@ryot-app/contract/modules/automations/history-schemas";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { createRyotMutation, createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	automationHistoryRunRecipe,
	automationHistoryRunsRecipe,
	type AutomationHistoryRunDetail,
	type AutomationHistoryRunsPage,
} from "@ryot-app/ryotql-recipes/automation-history";
import type { Option } from "effect";
import { Effect } from "effect";

import type { AuthenticatedApiError } from "#/api/authenticated";
import { AutomationHistoryApi } from "#/api/automation-history";
import type { KernelHostServices } from "#/host-services";

export type AutomationRunDetail =
	AutomationHistoryRunDetail extends Option.Option<infer Run> ? Run : never;

type AutomationHistoryQueryInput = Omit<
	Parameters<typeof automationHistoryRunsRecipe>[0],
	"after" | "limit"
> & { readonly cursor?: string; readonly limit?: number };

export const automationHistoryPageQuery = createRyotQuery<
	AutomationHistoryQueryInput,
	AutomationHistoryRunsPage,
	KernelHostServices
>(
	({ input, client }) =>
		client.data.query(
			automationHistoryRunsRecipe({
				...input,
				after: input.cursor,
				limit: input.limit ?? AUTOMATION_HISTORY_LIMITS.defaultPageSize,
			}),
		),
	{ cancelOnUnmount: true },
);

export const automationHistoryDetailQuery = createRyotQuery<
	string,
	AutomationRunDetail,
	KernelHostServices
>(({ input, client }) =>
	client.data
		.query(automationHistoryRunRecipe({ id: input }))
		.pipe(Effect.flatMap(Effect.fromOption(() => new RyotClientError("malformed-result")))),
);

export const retryAutomationRunMutation = createRyotMutation<
	{ readonly runId: string; readonly expectedAttemptCount: number },
	AutomationHistoryRetryResult,
	KernelHostServices,
	AuthenticatedApiError
>(({ input, hostServices }) =>
	hostServices.runtime
		.runSync(AutomationHistoryApi)
		.retryRun(hostServices.scope, {
			params: { runId: AutomationRunId.make(input.runId) },
			payload: { expectedAttemptCount: input.expectedAttemptCount },
		}),
);
