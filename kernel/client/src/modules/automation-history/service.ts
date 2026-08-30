import { createRyotMutation, createRyotQuery } from "@ryot-app/client-sdk/react";
import type { AutomationHistoryRetryResult } from "@ryot-app/contract/modules/automations/history-schemas";
import { AUTOMATION_HISTORY_LIMITS } from "@ryot-app/contract/modules/automations/history-schemas";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import {
	automationHistoryRunRecipe,
	automationHistoryRunsRecipe,
	type AutomationHistoryRunDetail,
	type AutomationHistoryRunsPage,
} from "@ryot-app/ryotql-recipes/automation-history";
import { Effect, Option } from "effect";

import { AutomationHistoryApi } from "#/api/automation-history";
import type { KernelHostServices } from "#/host-services";

export type AutomationRunDetail =
	AutomationHistoryRunDetail extends Option.Option<infer Run> ? Run : never;

type AutomationHistoryQueryInput = Omit<
	Parameters<typeof automationHistoryRunsRecipe>[0],
	"after" | "limit"
> & { readonly cursor?: string; readonly limit?: number };

export type AutomationHistoryPageResult = {
	readonly cursor: string | undefined;
	readonly page: Pick<AutomationHistoryRunsPage, "items"> & {
		readonly nextCursor: AutomationHistoryRunsPage["pageInfo"]["nextCursor"];
	};
};

export const automationHistoryPageQuery = createRyotQuery<
	AutomationHistoryQueryInput,
	AutomationHistoryPageResult,
	KernelHostServices
>(
	async ({ input, client, signal }) => {
		const page = await client.data.query(
			automationHistoryRunsRecipe({
				...input,
				after: input.cursor,
				limit: input.limit ?? AUTOMATION_HISTORY_LIMITS.defaultPageSize,
			}),
			{ signal },
		);
		return {
			cursor: input.cursor,
			page: { items: page.items, nextCursor: page.pageInfo.nextCursor },
		};
	},
	{ cancelOnUnmount: true },
);

export const automationHistoryDetailQuery = createRyotQuery<
	string,
	AutomationRunDetail,
	KernelHostServices
>(async ({ input, client, signal }) => {
	const result = await client.data.query(automationHistoryRunRecipe({ id: input }), { signal });
	if (Option.isNone(result)) {
		throw new Error("Automation run not found");
	}
	return result.value;
});

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
