import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { EntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import { displayValueText } from "@ryot-app/plugin-ui-sdk/table";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import type { SavedViewRecord } from "@ryot-app/ryotql-recipes/saved-view-records";
import {
	type LibrarySearchHit,
	librarySearchRecipe,
	type LibrarySearchResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect, Fiber, Result, Schema } from "effect";

import { savedViewHref } from "#/modules/plugins/catalog/location";
import { settingsGroups } from "#/modules/settings/sections";
import { navigationViewHref } from "#/modules/shell/sidebar-sections";

export const SEARCH_DEBOUNCE_MS = 120;
export const COMMIT_BUDGET_MS = 450;
const LIBRARY_HITS_PER_VIEW = 8;
const TOP_RESULT_LIMIT = 5;
const PAGE_PREVIEW_LIMIT = 3;

export const GO_TO_GROUP = "Go to";
export const ALL_FILTER = "all";
export const PAGES_FILTER = "pages";

export type ViewOutcome = Result.Result<LibrarySearchResult, "failed">;

export type CommandFilter = {
	readonly key: string;
	readonly label: string;
	readonly count?: number | undefined;
};

export type CommandGroup = {
	readonly key: string;
	readonly heading: string;
	readonly count?: number | undefined;
	readonly options: readonly CommandOption[];
};

export type LibraryCommit = {
	readonly query: string;
	readonly complete: boolean;
	readonly outcomes: readonly { readonly view: LibraryView; readonly outcome: ViewOutcome }[];
};

export type CommandResults = {
	readonly empty: boolean;
	readonly filter: string;
	readonly failed: readonly LibraryView[];
	readonly groups: readonly CommandGroup[];
	readonly filters: readonly CommandFilter[];
};

export type LibraryView = {
	readonly id: string;
	readonly href: string;
	readonly icon: string;
	readonly name: string;
	readonly providerAdd: boolean;
	readonly dataSources: RyotQLDocument;
	readonly settings: EntityBrowserSavedViewSettings;
};

export type CommandOption = {
	readonly id: string;
	readonly href: string;
	readonly icon: string;
	readonly label: string;
	readonly group: string;
	readonly tag?: string | undefined;
	readonly description?: string | undefined;
	readonly art?: undefined | { readonly image: null | AssetLocator };
};

const matchesText = (text: string, query: string) =>
	text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

export const destinationOptions = (input: {
	readonly navigation: NavigationData;
	readonly catalog: PluginClientCatalog;
}): readonly CommandOption[] => [
	...input.navigation.savedViews
		.filter((view) => !view.isHidden)
		.map((view) => ({
			icon: view.icon,
			label: view.name,
			group: GO_TO_GROUP,
			href: navigationViewHref(view),
			id: `view:${navigationViewHref(view)}`,
		})),
	...input.navigation.collections.map((collection) => ({
		group: GO_TO_GROUP,
		icon: collection.icon,
		label: collection.name,
		id: `collection:${collection.slug}`,
		href: `/e/${encodeURIComponent(collection.slug)}`,
	})),
	...input.catalog
		.filter(({ health, isHidden }) => health === "ready" && !isHidden)
		.map((plugin) => ({
			icon: plugin.icon,
			label: plugin.name,
			group: GO_TO_GROUP,
			description: "Workspace",
			href: pluginPath(plugin.packageId),
			id: `plugin:${plugin.installationId}`,
		})),
	{
		icon: "settings",
		label: "Settings",
		href: "/settings",
		group: GO_TO_GROUP,
		id: "kernel:settings",
	},
	...settingsGroups.flatMap((group) =>
		group.sections.map((section) => ({
			icon: section.icon,
			href: section.path,
			group: GO_TO_GROUP,
			label: section.label,
			description: "Settings",
			id: `settings:${section.slug}`,
		})),
	),
	{
		group: GO_TO_GROUP,
		icon: "sliders-horizontal",
		label: "Customize sidebar",
		href: "/customize-sidebar",
		id: "kernel:customize-sidebar",
	},
];

export const filterOptions = (options: readonly CommandOption[], query: string) =>
	query.trim() === "" ? options : options.filter(({ label }) => matchesText(label, query));

export const libraryViews = (records: readonly SavedViewRecord[]): readonly LibraryView[] =>
	records.flatMap((record): readonly LibraryView[] => {
		const dataSources = record.dataSources;
		if (
			record.isHidden ||
			dataSources === null ||
			record.renderer.kind !== "kernel" ||
			record.renderer.name !== "entity-browser"
		) {
			return [];
		}
		const settings = Schema.decodeUnknownResult(EntityBrowserSavedViewSettings)(record.settings);
		const href = savedViewHref(record.reference, record.packageId);
		if (
			Result.isFailure(settings) ||
			href === undefined ||
			settings.success.searchFields.length === 0
		) {
			return [];
		}
		return [
			{
				href,
				dataSources,
				id: record.id,
				icon: record.icon,
				name: record.name,
				settings: settings.success,
				providerAdd: settings.success.addAction?.type === "provider-search",
			},
		];
	});

type LibraryExecute<Failure> = (
	recipe: PreparedRecipe<LibrarySearchResult>,
) => Effect.Effect<LibrarySearchResult, Failure>;

const searchLibraryView = <Failure>(
	view: LibraryView,
	query: string,
	execute: LibraryExecute<Failure>,
): Effect.Effect<LibrarySearchResult, Error | Failure> => {
	const prepared = librarySearchRecipe({
		searchText: query,
		settings: view.settings,
		limit: LIBRARY_HITS_PER_VIEW,
		queryDocument: view.dataSources,
	});
	return Result.isFailure(prepared) ? Effect.fail(prepared.failure) : execute(prepared.success);
};

export const runLibrarySearch = <Failure>(input: {
	readonly query: string;
	readonly views: readonly LibraryView[];
	readonly execute: LibraryExecute<Failure>;
	readonly onCommit: (commit: LibraryCommit) => void;
}) =>
	Effect.gen(function* () {
		yield* Effect.sleep(SEARCH_DEBOUNCE_MS);
		const settled = new Map<string, ViewOutcome>();
		const shown: LibraryView[] = [];
		let committed = false;
		const commit = () =>
			input.onCommit({
				query: input.query,
				complete: settled.size === input.views.length,
				outcomes: shown.flatMap((view) => {
					const outcome = settled.get(view.id);
					return outcome === undefined ? [] : [{ view, outcome }];
				}),
			});
		const searches = yield* Effect.forkChild(
			Effect.forEach(
				input.views,
				(view) =>
					searchLibraryView(view, input.query, input.execute).pipe(
						Effect.match({
							onFailure: (): ViewOutcome => Result.fail("failed"),
							onSuccess: (result): ViewOutcome => Result.succeed(result),
						}),
						Effect.flatMap((outcome) =>
							Effect.sync(() => {
								settled.set(view.id, outcome);
								if (committed) {
									shown.push(view);
									commit();
								}
							}),
						),
					),
				{ discard: true, concurrency: "unbounded" },
			),
		);
		yield* Effect.race(Fiber.join(searches), Effect.sleep(COMMIT_BUDGET_MS));
		committed = true;
		shown.push(...input.views.filter(({ id }) => settled.has(id)));
		commit();
		yield* Fiber.join(searches);
	});

const providerOption = (view: LibraryView, query: string): CommandOption => ({
	icon: "plus",
	group: "Actions",
	id: `add:${view.id}`,
	description: view.name,
	label: `Search providers for "${query}"`,
	href: `${view.href}?${new URLSearchParams({ q: query, add: "true" }).toString()}`,
});

const hitOption = (view: LibraryView, hit: LibrarySearchHit): CommandOption => {
	const subtitle = hit.subtitle === null ? "" : displayValueText(hit.subtitle);
	return {
		tag: view.name,
		icon: view.icon,
		label: hit.name,
		group: view.name,
		id: `entity:${view.id}:${hit.entityId}`,
		href: `/e/${encodeURIComponent(hit.entityId)}`,
		description: subtitle === "" ? undefined : subtitle,
		art: view.settings.summary.image === null ? undefined : { image: hit.image },
	};
};

type FoundView = { readonly view: LibraryView; readonly result: LibrarySearchResult };

const rankedHits = (found: readonly FoundView[], query: string) => {
	const exact = query.toLocaleLowerCase();
	return sortBy(
		found.flatMap(({ view, result }) => result.hits.map((hit) => ({ hit, view }))),
		[({ hit }) => hit.rank, ({ hit }) => hit.name.toLocaleLowerCase() !== exact],
	);
};

export const idleGroups = (input: {
	readonly recents: readonly CommandOption[];
	readonly destinations: readonly CommandOption[];
}): readonly CommandGroup[] =>
	[
		{ key: "recents", heading: "Recent", options: input.recents },
		{ key: "go-to", heading: GO_TO_GROUP, options: input.destinations },
	].filter(({ options }) => options.length > 0);

export const commandResults = (input: {
	readonly filter: string;
	readonly commit: LibraryCommit;
	readonly destinations: readonly CommandOption[];
}): CommandResults => {
	const { query, outcomes } = input.commit;
	const found = outcomes.flatMap(({ view, outcome }): readonly FoundView[] =>
		Result.isSuccess(outcome) && outcome.success.total > 0
			? [{ view, result: outcome.success }]
			: [],
	);
	const failed = outcomes.flatMap(({ view, outcome }) => (Result.isFailure(outcome) ? [view] : []));
	const pages = filterOptions(input.destinations, query);
	const filters: readonly CommandFilter[] = [
		{ label: "All", key: ALL_FILTER },
		...found.map(({ view, result }) => ({ key: view.id, label: view.name, count: result.total })),
		...(pages.length > 0 ? [{ label: "Pages", key: PAGES_FILTER, count: pages.length }] : []),
	];
	const filter = filters.some(({ key }) => key === input.filter) ? input.filter : ALL_FILTER;
	if (filter === PAGES_FILTER) {
		return {
			filter,
			failed,
			filters,
			empty: false,
			groups: [{ key: "pages", options: pages, heading: "Pages" }],
		};
	}
	const scoped = found.find(({ view }) => view.id === filter);
	if (scoped !== undefined) {
		return {
			filter,
			failed,
			filters,
			empty: false,
			groups: [
				{
					key: scoped.view.id,
					heading: scoped.view.name,
					count: scoped.result.total,
					options: scoped.result.hits.map((hit) => hitOption(scoped.view, hit)),
				},
				...(scoped.view.providerAdd
					? [{ key: "actions", heading: "Actions", options: [providerOption(scoped.view, query)] }]
					: []),
			],
		};
	}
	const top = rankedHits(found, query).slice(0, TOP_RESULT_LIMIT);
	const providerView = [
		...top.map(({ view }) => view),
		...found.map(({ view }) => view),
		...outcomes.map(({ view }) => view),
	].find(({ providerAdd }) => providerAdd);
	const groups: readonly CommandGroup[] = [
		{
			key: "top",
			heading: "Top results",
			options: top.map(({ hit, view }) => hitOption(view, hit)),
			count: found.reduce((total, { result }) => total + result.total, 0),
		},
		{ key: "pages", heading: "Pages", options: pages.slice(0, PAGE_PREVIEW_LIMIT) },
		{
			key: "actions",
			heading: "Actions",
			options: providerView === undefined ? [] : [providerOption(providerView, query)],
		},
	];
	return {
		filter,
		failed,
		filters,
		empty: top.length === 0 && pages.length === 0,
		groups: groups.filter(({ options }) => options.length > 0),
	};
};

export const selectableOptions = (groups: readonly CommandGroup[]) =>
	groups.flatMap(({ options }) => options);
