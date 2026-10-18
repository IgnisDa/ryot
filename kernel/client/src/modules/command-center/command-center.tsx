import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { savedViewRecordsRecipe } from "@ryot-app/ryotql-recipes/saved-view-records";
import { Effect } from "effect";
import { useEffect, useMemo, useState } from "react";

import type { ApiScope } from "#/api/scope";
import { CommandCenterDialog } from "#/modules/command-center/command-center-dialog";
import {
	ACTIONS_GROUP,
	type CommandGroup,
	type CommandOption,
	destinationOptions,
	filterOptions,
	GO_TO_GROUP,
	LIBRARY_VIEWS_KEY,
	type LibraryGroupResult,
	libraryGroups,
	type LibraryView,
	libraryViews,
	type LibraryViewsState,
	providerAddOptions,
	runLibrarySearch,
} from "#/modules/command-center/model";
import { recordRecent } from "#/modules/command-center/recents";
import { ClientStorage } from "#/persistence/storage";
import type { ClientRuntime } from "#/runtime";

const SAVED_VIEW_LIMIT = 100;
const NO_VIEWS: readonly LibraryView[] = [];

type CommandCenterProps = {
	readonly scope: ApiScope;
	readonly onClose: () => void;
	readonly runtime: ClientRuntime;
	readonly navigation: NavigationData;
	readonly catalog: PluginClientCatalog;
	readonly onInterceptBack: () => boolean;
	readonly onNavigate: (href: string) => void;
};

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
	const [viewsState, setViewsState] = useState<LibraryViewsState>({ status: "pending" });
	const views = viewsState.status === "ready" ? viewsState.views : NO_VIEWS;
	const viewsPending = viewsState.status === "pending";
	const [recents, setRecents] = useState<readonly CommandOption[]>([]);
	const [results, setResults] = useState<{
		readonly query: string;
		readonly byView: ReadonlyMap<string, LibraryGroupResult>;
	}>({ query: "", byView: new Map() });
	const trimmed = query.trim();
	const request = useMemo(() => ({ attempt, query: trimmed }), [trimmed, attempt]);
	const destinations = useMemo(
		() => destinationOptions({ catalog, navigation }),
		[catalog, navigation],
	);

	useEffect(() => {
		if (!viewsPending) {
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
	}, [ryot, schedule, viewsPending]);
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
		if (request.query === "" || views.length === 0) {
			return undefined;
		}
		return schedule.run(
			runLibrarySearch({
				views,
				query: request.query,
				execute: (recipe) => ryot.data.query(recipe),
				onGroup: (viewId, result) =>
					setResults((current) => ({
						query: request.query,
						byView: new Map(current.query === request.query ? current.byView : []).set(
							viewId,
							result,
						),
					})),
			}),
			() => undefined,
		);
	}, [ryot, request, schedule, views]);

	const groups = useMemo((): readonly CommandGroup[] => {
		if (trimmed === "") {
			const idle: readonly CommandGroup[] = [
				{ key: "recents", status: "ready", options: recents, heading: "Recent" },
				{ key: "go-to", status: "ready", heading: GO_TO_GROUP, options: destinations },
			];
			return idle.filter(({ options }) => options.length > 0);
		}
		const matches = filterOptions(destinations, trimmed);
		const library = libraryGroups(viewsState, (view) =>
			results.query === trimmed ? results.byView.get(view.id) : undefined,
		);
		const matched = new Set(
			library.filter(({ options }) => options.length > 0).map(({ key }) => key),
		);
		const actions = providerAddOptions(views, trimmed, matched);
		return [
			{ key: "go-to", options: matches, heading: GO_TO_GROUP, status: "ready" as const },
			...library,
			{ key: "actions", options: actions, heading: ACTIONS_GROUP, status: "ready" as const },
		].filter(({ status, options }) => options.length > 0 || status !== "ready");
	}, [destinations, recents, results, trimmed, views, viewsState]);

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
			groups={groups}
			onSelect={select}
			onClose={props.onClose}
			onQueryChange={setQuery}
			onInterceptBack={props.onInterceptBack}
			onRetry={(key) => {
				if (key === LIBRARY_VIEWS_KEY) {
					setViewsState({ status: "pending" });
					return;
				}
				setResults({ query: "", byView: new Map() });
				setAttempt((value) => value + 1);
			}}
		/>
	);
}
