import { useRyotQuery } from "@ryot-app/client-sdk/react";
import { AUTOMATION_HISTORY_LIMITS } from "@ryot-app/contract/modules/automations/history-schemas";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
	AutomationHistoryView,
	type AutomationHistoryListState,
} from "#/modules/automation-history/history-view";
import {
	automationHistoryPageQuery,
	type AutomationHistoryPageResult,
} from "#/modules/automation-history/service";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { RUN_LIST_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";
import { useNowMs } from "#/modules/ui/use-now-ms";

const isActiveRun = (status: string) => status === "queued" || status === "running";

const withOlderPage = (
	pages: readonly AutomationHistoryPageResult[],
	result: AutomationHistoryPageResult,
): readonly AutomationHistoryPageResult[] => {
	const index = pages.findIndex((entry) => entry.cursor === result.cursor);
	if (index !== -1) {
		if (pages[index] === result) {
			return pages;
		}
		return pages.map((entry, entryIndex) => (entryIndex === index ? result : entry));
	}
	if (pages.at(-1)?.page.nextCursor !== result.cursor) {
		return pages;
	}
	return [...pages, result];
};

export const Route = createFileRoute("/_authenticated/settings/automation-history/")({
	component: AutomationHistoryRoute,
});

function AutomationHistoryRoute() {
	const [cursor, setCursor] = useState<string>();
	const [pages, setPages] = useState<readonly AutomationHistoryPageResult[]>([]);
	const firstPageInput = useMemo(() => ({ limit: AUTOMATION_HISTORY_LIMITS.defaultPageSize }), []);
	const firstPageQuery = useRyotQuery(automationHistoryPageQuery, firstPageInput);
	const currentPageInput = useMemo(
		() =>
			cursor === undefined
				? firstPageInput
				: { cursor, limit: AUTOMATION_HISTORY_LIMITS.defaultPageSize },
		[cursor, firstPageInput],
	);
	const currentPageQuery = useRyotQuery(automationHistoryPageQuery, currentPageInput);

	let nextPages = pages;
	let nextPagesCursor = cursor;
	const firstResult = firstPageQuery.data;
	const currentFirst = pages.at(0);
	if (firstResult !== undefined && currentFirst !== firstResult) {
		if (
			currentFirst === undefined ||
			currentFirst.page.nextCursor === firstResult.page.nextCursor
		) {
			nextPages = [firstResult, ...pages.slice(1)];
		} else {
			nextPages = [firstResult];
			nextPagesCursor = undefined;
		}
	}
	const currentResult = currentPageQuery.data;
	if (nextPagesCursor !== undefined && currentResult !== undefined) {
		nextPages = withOlderPage(nextPages, currentResult);
	}
	if (nextPages !== pages) {
		setPages(nextPages);
	}
	if (nextPagesCursor !== cursor) {
		setCursor(nextPagesCursor);
	}

	const runs = pages.flatMap((entry) => entry.page.items);
	const nextCursor = pages.at(-1)?.page.nextCursor ?? null;
	const query = cursor === undefined ? firstPageQuery : currentPageQuery;
	const currentPageHasActiveRun =
		pages.at(-1)?.page.items.some((run) => isActiveRun(run.status)) ?? false;
	const hasActiveRunOnUnrefreshedPage = pages
		.slice(1, -1)
		.some((entry) => entry.page.items.some((run) => isActiveRun(run.status)));
	let state: AutomationHistoryListState;
	if (pages.length === 0) {
		state = query.isError ? { status: "failed" } : { status: "loading" };
	} else if (runs.length === 0) {
		state = { status: "empty" };
	} else {
		state = { runs, nextCursor, status: "ready" };
	}
	useRunPolling({
		intervalMs: RUN_LIST_POLL_MS,
		enabled: state.status === "ready" && state.runs.some((run) => isActiveRun(run.status)),
		refresh: () => {
			firstPageQuery.refetch();
			if (cursor !== undefined && currentPageHasActiveRun) {
				currentPageQuery.refetch();
			}
			if (hasActiveRunOnUnrefreshedPage) {
				setCursor(undefined);
				setPages((current) => current.slice(0, 1));
			}
		},
	});

	const nowMs = useNowMs(RUN_LIST_POLL_MS);

	return (
		<SettingsFrame title="Automation history" backFallbackHref="/settings">
			<AutomationHistoryView
				state={state}
				nowMs={nowMs}
				onRetry={query.refetch}
				olderLoadFailed={pages.length > 0 && query.isError}
				isLoadingOlder={cursor !== undefined && query.isFetching}
				onShowOlder={() => {
					if (query.isError) {
						query.refetch();
					} else if (nextCursor !== null) {
						setCursor(nextCursor);
					}
				}}
			/>
		</SettingsFrame>
	);
}
