import { useRyot } from "@ryot-app/client-sdk/react";
import type { ImportRunList } from "@ryot-app/ryotql-recipes/import-runs";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { ImportsApi } from "#/api/imports";
import { createKernelRyotClient } from "#/api/ryot-client";
import {
	IMPORT_LOAD_ERROR,
	ImportDataView,
	type ImportRunListState,
} from "#/modules/imports/import-data-view";
import { liveImportRun } from "#/modules/imports/run-presentation";
import { IMPORT_RUNS_PAGE_SIZE, ImportsService } from "#/modules/imports/service";
import { importSourceNames } from "#/modules/imports/source-selection";
import { ImportStartWizard, type ImportSourcePickerState } from "#/modules/imports/start-wizard";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { LoadErrorState } from "#/modules/ui/load-error-state";
import { RUN_LIST_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";
import { useSearchParamModal } from "#/modules/ui/search-param-modal";
import { StatusState } from "#/modules/ui/status-state";

const listState = (page: ImportRunList): ImportRunListState =>
	page.items.length === 0
		? { status: "empty" }
		: { status: "ready", runs: page.items, hasMore: page.pageInfo.hasMore };

export const Route = createFileRoute("/_authenticated/settings/import-data/")({
	component: ImportDataRoute,
	errorComponent: ImportDataLoadError,
	pendingComponent: ImportDataPending,
	validateSearch: (search) => ({
		start: search.start === true || search.start === "true" ? true : undefined,
	}),
	loader: async ({ abortController, context }) => {
		const ryot = createKernelRyotClient(context.runtime, context.scope, context.theme);
		const [page, sources] = await Promise.all([
			context.runtime.runPromise(
				Effect.flatMap(ImportsService, (service) =>
					service.loadRuns(ryot, { limit: IMPORT_RUNS_PAGE_SIZE }),
				),
				{ signal: abortController.signal },
			),
			context.runtime.runPromise(
				Effect.flatMap(ImportsApi, (api) => api.listSources(context.scope)).pipe(
					Effect.match({
						onFailure: (): ImportSourcePickerState => ({ status: "failed" }),
						onSuccess: (listed): ImportSourcePickerState =>
							listed.length === 0 ? { status: "empty" } : { status: "ready", sources: listed },
					}),
				),
				{ signal: abortController.signal },
			),
		]);
		return { page, sources };
	},
});

function ImportDataFrame(props: { readonly children: ReactNode }) {
	return (
		<SettingsFrame title="Import data" backFallbackHref="/settings">
			{props.children}
		</SettingsFrame>
	);
}

function ImportDataRoute() {
	const ryot = useRyot();
	const navigate = Route.useNavigate();
	const { start } = Route.useSearch();
	const loaded = Route.useLoaderData();
	const { runtime, scope } = Route.useRouteContext();
	const controller = useRef(new AbortController());
	const [isLoadingOlder, setIsLoadingOlder] = useState(false);
	const [limit, setLimit] = useState(IMPORT_RUNS_PAGE_SIZE);
	const [sources, setSources] = useState(loaded.sources);
	const [state, setState] = useState(() => listState(loaded.page));

	useEffect(() => () => controller.current.abort(), []);

	const reload = useEffectEvent(async (nextLimit: number) => {
		setIsLoadingOlder(nextLimit > limit);
		const outcome = await runtime.runPromise(
			Effect.flatMap(ImportsService, (service) =>
				service.loadRuns(ryot, { limit: nextLimit }),
			).pipe(
				Effect.match({
					onFailure: () => undefined,
					onSuccess: (page) => listState(page),
				}),
			),
			{ signal: controller.current.signal },
		);
		setIsLoadingOlder(false);
		setLimit(nextLimit);
		setState(outcome ?? { status: "failed" });
	});

	const reloadSources = useEffectEvent(async () => {
		setSources({ status: "loading" });
		const next = await runtime.runPromise(
			Effect.flatMap(ImportsApi, (api) => api.listSources(scope)).pipe(
				Effect.match({
					onFailure: (): ImportSourcePickerState => ({ status: "failed" }),
					onSuccess: (listed): ImportSourcePickerState =>
						listed.length === 0 ? { status: "empty" } : { status: "ready", sources: listed },
				}),
			),
			{ signal: controller.current.signal },
		);
		setSources(next);
	});

	const wizard = useSearchParamModal({
		isOpen: start === true,
		open: () => void navigate({ search: { start: true } }),
		onCompleted: () => void reload(IMPORT_RUNS_PAGE_SIZE),
		close: () => void navigate({ replace: true, search: { start: undefined } }),
	});

	useRunPolling({
		intervalMs: RUN_LIST_POLL_MS,
		refresh: () => void reload(limit),
		enabled: state.status === "ready" && liveImportRun(state.runs) !== undefined,
	});

	return (
		<ImportDataFrame>
			<ImportDataView
				state={state}
				nowMs={Date.now()}
				onStartImport={wizard.open}
				isLoadingOlder={isLoadingOlder}
				onRetry={() => void reload(limit)}
				onShowOlder={() => void reload(limit + IMPORT_RUNS_PAGE_SIZE)}
				sourceNames={importSourceNames(sources.status === "ready" ? sources.sources : [])}
			/>
			{start === true && (
				<ImportStartWizard
					sources={sources}
					onClose={wizard.close}
					onStarted={wizard.markCompleted}
					onRetrySources={() => void reloadSources()}
				/>
			)}
		</ImportDataFrame>
	);
}

function ImportDataPending() {
	return (
		<ImportDataFrame>
			<StatusState className="py-16" detail="Loading your imports..." />
		</ImportDataFrame>
	);
}

function ImportDataLoadError() {
	const router = useRouter();
	return (
		<ImportDataFrame>
			<LoadErrorState
				title={IMPORT_LOAD_ERROR.title}
				detail={IMPORT_LOAD_ERROR.detail}
				onRetry={() => void router.invalidate()}
			/>
		</ImportDataFrame>
	);
}
