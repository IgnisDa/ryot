import {
	type RyotQueryResult,
	useRyotInfiniteQuery,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import type { ImportRunList } from "@ryot-app/ryotql-recipes/import-runs";
import { createFileRoute } from "@tanstack/react-router";

import { ImportDataView, type ImportRunListState } from "#/modules/imports/import-data-view";
import { liveImportRun } from "#/modules/imports/run-presentation";
import type { ImportSourceItem } from "#/modules/imports/service";
import {
	IMPORT_RUNS_PAGE_SIZE,
	importRunsQuery,
	importSourcesQuery,
} from "#/modules/imports/service";
import { importSourceNames } from "#/modules/imports/source-selection";
import { type ImportSourcePickerState, ImportStartWizard } from "#/modules/imports/start-wizard";
import { useIngestionCatalogRefresh } from "#/modules/plugins/catalog/provider";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { RUN_LIST_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";
import { useSearchParamModal } from "#/modules/ui/search-param-modal";
import { useNowMs } from "#/modules/ui/use-now-ms";

const listState = (page: ImportRunList): ImportRunListState =>
	page.items.length === 0
		? { status: "empty" }
		: { status: "ready", runs: page.items, hasMore: page.pageInfo.hasMore };

const queryListState = (page: undefined | ImportRunList, pending: boolean): ImportRunListState => {
	if (page !== undefined) {
		return listState(page);
	}
	return pending ? { status: "loading" } : { status: "failed" };
};

const sourcePickerState = (
	result: RyotQueryResult<readonly ImportSourceItem[]>,
): ImportSourcePickerState => {
	if (result.data === undefined) {
		return result.isPending ? { status: "loading" } : { status: "failed" };
	}
	return result.data.length === 0 ? { status: "empty" } : { status: "ready", sources: result.data };
};

export const Route = createFileRoute("/_authenticated/settings/import-data/")({
	component: ImportDataRoute,
	validateSearch: (search) => ({
		start: search.start === true || search.start === "true" ? true : undefined,
	}),
});

function ImportDataRoute() {
	const navigate = Route.useNavigate();
	const { start } = Route.useSearch();
	const runs = useRyotInfiniteQuery(importRunsQuery, undefined, {
		mode: "replace",
		initialPageParam: IMPORT_RUNS_PAGE_SIZE,
		getPageInput: (_input, limit) => ({ limit }),
		getNextPageParam: (page, limit) =>
			page.pageInfo.hasMore ? limit + IMPORT_RUNS_PAGE_SIZE : null,
	});
	const sourceResult = useRyotQuery(importSourcesQuery);
	useIngestionCatalogRefresh(sourceResult.refetch);
	const page = runs.data;
	const nowMs = useNowMs(RUN_LIST_POLL_MS);
	const state = queryListState(page, runs.isPending);
	const sources = sourcePickerState(sourceResult);

	const wizard = useSearchParamModal({
		isOpen: start === true,
		onCompleted: () => undefined,
		open: () => void navigate({ search: { start: true } }),
		close: () => void navigate({ replace: true, search: { start: undefined } }),
	});

	useRunPolling({
		refresh: runs.refetch,
		intervalMs: RUN_LIST_POLL_MS,
		enabled: state.status === "ready" && liveImportRun(state.runs) !== undefined,
	});

	return (
		<SettingsFrame title="Import data" backFallbackHref="/settings">
			<ImportDataView
				state={state}
				nowMs={nowMs}
				onRetry={runs.refetch}
				onStartImport={wizard.open}
				isFetching={runs.isFetching}
				isFetchingNextPage={runs.isFetchingNextPage}
				sourceNames={importSourceNames(sources.status === "ready" ? sources.sources : [])}
				onShowOlder={() => {
					if (runs.errorOperation === "append") {
						runs.retry();
					} else {
						runs.fetchNextPage();
					}
				}}
			/>
			{start === true && (
				<ImportStartWizard
					sources={sources}
					onClose={wizard.close}
					onStarted={wizard.markCompleted}
					onRetrySources={sourceResult.refetch}
				/>
			)}
		</SettingsFrame>
	);
}
