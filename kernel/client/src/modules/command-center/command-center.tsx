import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { savedViewRecordsRecipe } from "@ryot-app/ryotql-recipes/saved-view-records";
import { Effect } from "effect";
import { useEffect, useMemo, useState } from "react";

import type { ApiScope } from "#/api/scope";
import { CommandCenterDialog } from "#/modules/command-center/command-center-dialog";
import {
	ALL_FILTER,
	type CommandOption,
	type CommandResults,
	commandResults,
	destinationOptions,
	idleGroups,
	type LibraryCommit,
	type LibraryView,
	libraryViews,
	runLibrarySearch,
} from "#/modules/command-center/model";
import { recordRecent } from "#/modules/command-center/recents";
import { ClientStorage } from "#/persistence/storage";
import type { ClientRuntime } from "#/runtime";

const SAVED_VIEW_LIMIT = 100;

type CommandCenterProps = {
	readonly scope: ApiScope;
	readonly onClose: () => void;
	readonly runtime: ClientRuntime;
	readonly navigation: NavigationData;
	readonly catalog: PluginClientCatalog;
	readonly onInterceptBack: () => boolean;
	readonly onNavigate: (href: string) => void;
};

type LibraryViewsState =
	| { readonly status: "pending" | "failed" }
	| { readonly status: "ready"; readonly views: readonly LibraryView[] };

const recentOptions = (
	recents: readonly {
		readonly href: string;
		readonly icon: string;
		readonly label: string;
		readonly group: string;
	}[],
): readonly CommandOption[] =>
	recents.map((recent) => ({ ...recent, description: recent.group, id: `recent:${recent.href}` }));

export function CommandCenter(props: CommandCenterProps) {
	const { scope, runtime, catalog, navigation } = props;
	const ryot = useRyot();
	const schedule = useRyotSchedule();
	const [query, setQuery] = useState("");
	const [attempt, setAttempt] = useState(0);
	const [filter, setFilter] = useState(ALL_FILTER);
	const [viewsState, setViewsState] = useState<LibraryViewsState>({ status: "pending" });
	const [recents, setRecents] = useState<readonly CommandOption[]>([]);
	const [commit, setCommit] = useState<LibraryCommit | undefined>(undefined);
	const trimmed = query.trim();
	const request = useMemo(() => ({ attempt, query: trimmed }), [trimmed, attempt]);
	const destinations = useMemo(
		() => destinationOptions({ catalog, navigation }),
		[catalog, navigation],
	);

	useEffect(() => {
		if (viewsState.status !== "pending") {
			return undefined;
		}
		return schedule.run(
			ryot.data
				.query(savedViewRecordsRecipe({ limit: SAVED_VIEW_LIMIT }))
				.pipe(
					Effect.match({
						onFailure: () => setViewsState({ status: "failed" }),
						onSuccess: (records) =>
							setViewsState({ status: "ready", views: libraryViews(records.items) }),
					}),
				),
			() => undefined,
		);
	}, [ryot, schedule, viewsState.status]);
	useEffect(() => {
		const fiber = runtime.runFork(
			Effect.flatMap(ClientStorage, (storage) => storage.getRecentDestinations(scope)).pipe(
				Effect.tap((stored) => Effect.sync(() => setRecents(recentOptions(stored)))),
			),
		);
		return () => {
			fiber.interruptUnsafe();
		};
	}, [runtime, scope]);
	useEffect(() => {
		if (request.query === "" || viewsState.status !== "ready") {
			return undefined;
		}
		return schedule.run(
			runLibrarySearch({
				onCommit: setCommit,
				query: request.query,
				views: viewsState.views,
				execute: (recipe) => ryot.data.query(recipe),
			}),
			() => undefined,
		);
	}, [ryot, schedule, request, viewsState]);

	const libraryFailed = viewsState.status === "failed";
	const shown = useMemo(
		() => (libraryFailed ? { outcomes: [], query: trimmed, complete: true } : commit),
		[libraryFailed, trimmed, commit],
	);
	const idle = useMemo(
		(): CommandResults => ({
			failed: [],
			filters: [],
			empty: false,
			filter: ALL_FILTER,
			groups: idleGroups({ recents, destinations }),
		}),
		[recents, destinations],
	);
	const results = useMemo(
		() => (shown === undefined ? idle : commandResults({ filter, destinations, commit: shown })),
		[filter, destinations, shown, idle],
	);
	const searching = trimmed !== "";

	const select = (option: CommandOption) => {
		const next = recordRecent(
			recents.map(({ href, icon, label, group }) => ({ href, icon, label, group })),
			{ href: option.href, icon: option.icon, label: option.label, group: option.group },
		);
		void runtime.runPromise(
			Effect.flatMap(ClientStorage, (storage) => storage.setRecentDestinations(scope, next)),
		);
		props.onClose();
		props.onNavigate(option.href);
	};

	return (
		<CommandCenterDialog
			query={query}
			onSelect={select}
			onClose={props.onClose}
			onFilterChange={setFilter}
			results={searching ? results : idle}
			onInterceptBack={props.onInterceptBack}
			stale={searching && shown?.query !== trimmed}
			pending={searching && (shown?.query !== trimmed || !shown.complete)}
			onQueryChange={(next) => {
				setQuery(next);
				if (next.trim() === "") {
					setCommit(undefined);
				}
			}}
			failed={[
				...(libraryFailed ? ["your library"] : []),
				...(searching ? results.failed.map(({ name }) => name) : []),
			]}
			onRetry={() => {
				if (libraryFailed) {
					setViewsState({ status: "pending" });
					return;
				}
				setAttempt((value) => value + 1);
			}}
		/>
	);
}
