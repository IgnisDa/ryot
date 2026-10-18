import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { EntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import type { SavedViewRecord } from "@ryot-app/ryotql-recipes/saved-view-records";
import {
	entityBrowserRecipe,
	type EntityBrowserResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import { Effect, Result, Schema } from "effect";

import { savedViewHref } from "#/modules/plugins/catalog/location";
import { settingsGroups } from "#/modules/settings/sections";
import { navigationViewHref } from "#/modules/shell/sidebar-sections";

export const SEARCH_DEBOUNCE_MS = 250;
const LIBRARY_ROWS_PER_VIEW = 3;
const LIBRARY_FETCH_LIMIT = 5;

export const GO_TO_GROUP = "Go to";
export const ACTIONS_GROUP = "Actions";
const PROVIDER_ACTION_LIMIT = 3;

export type CommandOption = {
	readonly id: string;
	readonly href: string;
	readonly icon: string;
	readonly label: string;
	readonly group: string;
	readonly description?: string | undefined;
};

type GroupStatus = "ready" | "pending" | "failed";

export type CommandGroup = {
	readonly key: string;
	readonly heading: string;
	readonly status: GroupStatus;
	readonly options: readonly CommandOption[];
	readonly retryKey?: string | undefined;
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

export const providerAddOptions = (
	views: readonly LibraryView[],
	query: string,
	matchedViewIds: ReadonlySet<string>,
): readonly CommandOption[] =>
	views
		.filter((view) => view.providerAdd)
		.sort(
			(left, right) => Number(matchedViewIds.has(right.id)) - Number(matchedViewIds.has(left.id)),
		)
		.slice(0, PROVIDER_ACTION_LIMIT)
		.map((view) => ({
			icon: "plus",
			group: ACTIONS_GROUP,
			id: `add:${view.id}`,
			description: view.name,
			label: `Search providers for "${query}"`,
			href: `${view.href}?${new URLSearchParams({ q: query, add: "true" }).toString()}`,
		}));

type LibraryExecute<Failure> = (
	recipe: PreparedRecipe<EntityBrowserResult>,
) => Effect.Effect<EntityBrowserResult, Failure>;

const searchLibraryView = <Failure>(
	view: LibraryView,
	query: string,
	execute: LibraryExecute<Failure>,
): Effect.Effect<readonly CommandOption[], Failure | Error> => {
	const prepared = entityBrowserRecipe({
		searchText: query,
		settings: view.settings,
		pageSize: LIBRARY_FETCH_LIMIT,
		queryDocument: view.dataSources,
	});
	if (Result.isFailure(prepared)) {
		return Effect.fail(prepared.failure);
	}
	return execute(prepared.success).pipe(
		Effect.map(({ items }) =>
			items
				.slice(0, LIBRARY_ROWS_PER_VIEW)
				.map((item) => ({
					icon: view.icon,
					label: item.name,
					group: view.name,
					id: `entity:${view.id}:${item.entityId}`,
					href: `/e/${encodeURIComponent(item.entityId)}`,
				})),
		),
	);
};

export type LibraryGroupResult = Result.Result<readonly CommandOption[], "failed">;

export type LibraryViewsState =
	| { readonly status: "pending" | "failed" }
	| { readonly status: "ready"; readonly views: readonly LibraryView[] };

export const LIBRARY_VIEWS_KEY = "library-views";

export const libraryGroups = (
	state: LibraryViewsState,
	resultFor: (view: LibraryView) => LibraryGroupResult | undefined,
): readonly CommandGroup[] => {
	if (state.status !== "ready") {
		return [{ options: [], heading: "Library", status: state.status, key: LIBRARY_VIEWS_KEY }];
	}
	return state.views.map((view): CommandGroup => {
		const result = resultFor(view);
		if (result === undefined) {
			return { options: [], key: view.id, status: "pending", heading: view.name };
		}
		return Result.isFailure(result)
			? { options: [], key: view.id, status: "failed", heading: view.name }
			: { key: view.id, status: "ready", heading: view.name, options: result.success };
	});
};

export const runLibrarySearch = <Failure>(input: {
	readonly query: string;
	readonly views: readonly LibraryView[];
	readonly execute: LibraryExecute<Failure>;
	readonly onGroup: (viewId: string, result: LibraryGroupResult) => void;
}) =>
	Effect.sleep(SEARCH_DEBOUNCE_MS).pipe(
		Effect.andThen(
			Effect.forEach(
				input.views,
				(view) =>
					searchLibraryView(view, input.query, input.execute).pipe(
						Effect.match({
							onFailure: () => input.onGroup(view.id, Result.fail("failed")),
							onSuccess: (options) => input.onGroup(view.id, Result.succeed(options)),
						}),
					),
				{ discard: true, concurrency: "unbounded" },
			),
		),
	);

export const selectableOptions = (groups: readonly CommandGroup[]) =>
	groups.flatMap(({ options }) => options);
