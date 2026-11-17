import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { displayValueText } from "@ryot-app/plugin-ui-sdk/table";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { savedViewRecordsRecipe } from "@ryot-app/ryotql-recipes/saved-view-records";
import { Effect, Result } from "effect";
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

type LibraryViewsState =
	| { readonly status: "failed" | "pending" }
	| { readonly status: "ready"; readonly views: readonly LibraryView[] };

type CommandCenterProps = {
	readonly scope: ApiScope;
	readonly onClose: () => void;
	readonly runtime: ClientRuntime;
	readonly navigation: NavigationData;
	readonly catalog: PluginClientCatalog;
	readonly onAsk: (text: string) => void;
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
	const t = useT();
	const formatters = useFormatters();
	const ryot = useRyot();
	const schedule = useRyotSchedule();
	const [query, setQuery] = useState("");
	const [attempt, setAttempt] = useState(0);
	const [filter, setFilter] = useState(ALL_FILTER);
	const [viewsState, setViewsState] = useState<LibraryViewsState>({ status: "pending" });
	const [recents, setRecents] = useState<readonly CommandOption[]>([]);
	const [commit, setCommit] = useState<undefined | LibraryCommit>(undefined);
	const trimmed = query.trim();
	const request = useMemo(() => ({ attempt, query: trimmed }), [trimmed, attempt]);
	const destinations = useMemo(
		() => destinationOptions({ t, catalog, navigation }),
		[catalog, navigation, t],
	);

	useEffect(() => {
		if (viewsState.status !== "pending") {
			return undefined;
		}
		return schedule.run(
			ryot.data
				.query(savedViewRecordsRecipe, {}, { pages: { savedViews: { limit: SAVED_VIEW_LIMIT } } })
				.pipe(
					Effect.match({
						onFailure: () => setViewsState({ status: "failed" }),
						onSuccess: (records) =>
							setViewsState({ status: "ready", views: libraryViews(records.items, t) }),
					}),
				),
			() => undefined,
		);
	}, [ryot, schedule, t, viewsState.status]);
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
				execute: (execution) => ryot.data.execute(execution, Result.succeed),
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
			groups: idleGroups({ t, recents, destinations }),
		}),
		[t, recents, destinations],
	);
	const results = useMemo(
		() =>
			shown === undefined
				? idle
				: commandResults({
						t,
						filter,
						destinations,
						commit: shown,
						displayValue: (value) => displayValueText(t, formatters, value),
					}),
		[filter, destinations, shown, idle, t, formatters],
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
			ask={searching ? { text: trimmed, onAsk: () => props.onAsk(trimmed) } : undefined}
			onQueryChange={(next) => {
				setQuery(next);
				if (next.trim() === "") {
					setCommit(undefined);
				}
			}}
			onRetry={() => {
				if (libraryFailed) {
					setViewsState({ status: "pending" });
					return;
				}
				setAttempt((value) => value + 1);
			}}
			failed={[
				...(libraryFailed ? [t(kernelMessage("client.command-center.library"))] : []),
				...(searching ? results.failed.map(({ name }) => name) : []),
			]}
		/>
	);
}
