import { AUTOMATION_HISTORY_LIMITS } from "@ryot-app/contract/modules/automations/history-schemas";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { createFileRoute } from "@tanstack/react-router";

import {
	type AutomationHistoryListState,
	AutomationHistoryView,
} from "#/modules/automation-history/history-view";
import { automationHistoryPageQuery } from "#/modules/automation-history/service";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { RUN_LIST_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";
import { useNowMs } from "#/modules/ui/use-now-ms";

const isActiveRun = (status: string) => status === "queued" || status === "running";
const initialCursor: string | undefined = undefined;

export const Route = createFileRoute("/_authenticated/settings/automation-history/")({
	component: AutomationHistoryRoute,
});

function AutomationHistoryRoute() {
	const query = useRyotInfiniteQuery(automationHistoryPageQuery, undefined, {
		initialPageParam: initialCursor,
		getNextPageParam: nextPageCursor,
		getPageInput: (_input, after: string | undefined) => ({
			cursor: after,
			limit: AUTOMATION_HISTORY_LIMITS.defaultPageSize,
		}),
	});
	const runs = paginationItems(
		query.pages,
		(page) => page.items,
		(run) => run.id,
	);
	const lastPage = query.pages.at(-1);
	const nextCursor = lastPage === undefined ? null : nextPageCursor(lastPage);
	let state: AutomationHistoryListState;
	if (query.pages.length === 0) {
		state = query.isError ? { status: "failed" } : { status: "loading" };
	} else if (runs.length === 0) {
		state = { status: "empty" };
	} else {
		state = { runs, nextCursor, status: "ready" };
	}
	useRunPolling({
		refresh: query.refetch,
		intervalMs: RUN_LIST_POLL_MS,
		enabled: state.status === "ready" && state.runs.some((run) => isActiveRun(run.status)),
	});

	const nowMs = useNowMs(RUN_LIST_POLL_MS);

	return (
		<SettingsFrame title="Automation history" backFallbackHref="/settings">
			<AutomationHistoryView
				state={state}
				nowMs={nowMs}
				onRetry={query.refetch}
				isFetching={query.isFetching}
				isFetchingNextPage={query.isFetchingNextPage}
				olderLoadFailed={query.errorOperation === "append"}
				onShowOlder={() => {
					if (query.errorOperation === "append") {
						query.retry();
					} else if (nextCursor !== null) {
						query.fetchNextPage();
					}
				}}
			/>
		</SettingsFrame>
	);
}
