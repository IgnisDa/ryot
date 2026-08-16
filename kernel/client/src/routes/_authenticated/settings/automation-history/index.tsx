import { useRyotQuery } from "@ryot-app/client-sdk/react";
import { AUTOMATION_HISTORY_LIMITS } from "@ryot-app/contract/modules/automations/history-schemas";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

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

const isActiveRun = (status: string) => status === "queued" || status === "running";

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

	useEffect(() => {
		const result = firstPageQuery.data;
		if (result === undefined) {
			return;
		}
		const first = pages.at(0);
		if (first !== undefined && first.page.nextCursor !== result.page.nextCursor) {
			setCursor(undefined);
		}
		setPages((current) => {
			const currentFirst = current.at(0);
			if (currentFirst === result) {
				return current;
			}
			if (currentFirst === undefined || currentFirst.page.nextCursor === result.page.nextCursor) {
				return [result, ...current.slice(1)];
			}
			return [result];
		});
	}, [firstPageQuery.data, pages]);

	useEffect(() => {
		if (
			cursor === undefined ||
			currentPageQuery.data === undefined ||
			(pages.at(0) !== undefined &&
				firstPageQuery.data !== undefined &&
				pages.at(0)?.page.nextCursor !== firstPageQuery.data.page.nextCursor)
		) {
			return;
		}
		const result = currentPageQuery.data;
		setPages((current) => {
			const index = current.findIndex((entry) => entry.cursor === result.cursor);
			if (index !== -1) {
				if (current[index] === result) {
					return current;
				}
				return current.map((entry, entryIndex) => (entryIndex === index ? result : entry));
			}
			if (current.at(-1)?.page.nextCursor !== result.cursor) {
				return current;
			}
			return [...current, result];
		});
	}, [cursor, currentPageQuery.data, firstPageQuery.data, pages]);

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

	return (
		<SettingsFrame title="Automation history" backFallbackHref="/settings">
			<AutomationHistoryView
				state={state}
				nowMs={Date.now()}
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
