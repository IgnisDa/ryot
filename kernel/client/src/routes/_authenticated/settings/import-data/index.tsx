import { useRyotQuery, type RyotQueryResult } from "@ryot-app/client-sdk/react";
import type { ImportRunList } from "@ryot-app/ryotql-recipes/import-runs";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ImportDataView, type ImportRunListState } from "#/modules/imports/import-data-view";
import { liveImportRun } from "#/modules/imports/run-presentation";
import type { ImportSourceItem } from "#/modules/imports/service";
import {
	IMPORT_RUNS_PAGE_SIZE,
	importRunsQuery,
	importSourcesQuery,
} from "#/modules/imports/service";
import { importSourceNames } from "#/modules/imports/source-selection";
import { ImportStartWizard, type ImportSourcePickerState } from "#/modules/imports/start-wizard";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { RUN_LIST_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";
import { useSearchParamModal } from "#/modules/ui/search-param-modal";

const listState = (page: ImportRunList): ImportRunListState =>
	page.items.length === 0
		? { status: "empty" }
		: { status: "ready", runs: page.items, hasMore: page.pageInfo.hasMore };

const queryListState = (page: ImportRunList | undefined, pending: boolean): ImportRunListState => {
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
	const [limit, setLimit] = useState(IMPORT_RUNS_PAGE_SIZE);
	const runs = useRyotQuery(importRunsQuery, { limit });
	const sourceResult = useRyotQuery(importSourcesQuery);
	const [retainedPage, setRetainedPage] = useState<ImportRunList>();
	useEffect(() => {
		if (runs.data !== undefined) {
			setRetainedPage(runs.data);
		}
	}, [runs.data]);
	const page = runs.data ?? retainedPage;
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
				nowMs={Date.now()}
				onRetry={runs.refetch}
				onStartImport={wizard.open}
				isLoadingOlder={runs.isFetching && page !== undefined}
				onShowOlder={() => setLimit((current) => current + IMPORT_RUNS_PAGE_SIZE)}
				sourceNames={importSourceNames(sources.status === "ready" ? sources.sources : [])}
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
