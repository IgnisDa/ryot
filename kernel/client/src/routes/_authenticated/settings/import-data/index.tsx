import { useRyot } from "@ryot-app/client-sdk/react";
import { Button } from "@ryot-app/client-ui-sdk";
import type { ImportRunList } from "@ryot-app/ryotql-recipes/import-runs";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { ImportsApi } from "#/api/imports";
import { createKernelRyotClient } from "#/api/ryot-client";
import { ImportDataView, type ImportRunListState } from "#/modules/imports/import-data-view";
import { liveImportRun } from "#/modules/imports/run-presentation";
import { IMPORT_RUNS_PAGE_SIZE, ImportsService } from "#/modules/imports/service";
import { importSourceNames } from "#/modules/imports/source-selection";
import { ImportStartWizard, type ImportSourcePickerState } from "#/modules/imports/start-wizard";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { RUN_LIST_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";
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
	const router = useRouter();
	const navigate = Route.useNavigate();
	const { start } = Route.useSearch();
	const loaded = Route.useLoaderData();
	const { runtime, scope } = Route.useRouteContext();
	const started = useRef(false);
	const pushedStart = useRef(false);
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

	const openWizard = () => {
		pushedStart.current = true;
		void navigate({ search: { start: true } });
	};

	const closeWizard = () => {
		if (pushedStart.current) {
			pushedStart.current = false;
			router.history.back();
			return;
		}
		void navigate({ replace: true, search: { start: undefined } });
	};

	useEffect(() => {
		if (start === true) {
			return;
		}
		pushedStart.current = false;
		if (!started.current) {
			return;
		}
		started.current = false;
		void reload(IMPORT_RUNS_PAGE_SIZE);
	}, [start]);

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
				onStartImport={openWizard}
				isLoadingOlder={isLoadingOlder}
				onRetry={() => void reload(limit)}
				onShowOlder={() => void reload(limit + IMPORT_RUNS_PAGE_SIZE)}
				sourceNames={importSourceNames(sources.status === "ready" ? sources.sources : [])}
			/>
			{start === true && (
				<ImportStartWizard
					sources={sources}
					onClose={closeWizard}
					onRetrySources={() => void reloadSources()}
					onStarted={() => {
						started.current = true;
					}}
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
			<StatusState
				detailTone="danger"
				title="Unable to load imports"
				className="rounded-xl border border-border bg-surface p-6"
				detail="Your import history could not be loaded. Check the server and try again."
				action={
					<Button type="button" variant="secondary" onClick={() => void router.invalidate()}>
						Try again
					</Button>
				}
			/>
		</ImportDataFrame>
	);
}
