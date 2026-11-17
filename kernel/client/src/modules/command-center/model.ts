import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import type { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import type { PluginExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import {
	EntityBrowserSavedViewSettings,
	type SavedViewDisplayValue,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { formatDisplayText } from "@ryot-app/i18n/format";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { decodeLibrarySearch } from "@ryot-app/ryotql-recipes/library-search";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import type { SavedViewRecord } from "@ryot-app/ryotql-recipes/saved-view-records";
import type { LibrarySearchHit, LibrarySearchResult } from "@ryot-app/ryotql-recipes/saved-views";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect, Fiber, Result, Schema } from "effect";

import { ASSISTANT_NAME } from "#/modules/assistant/presentation";
import { savedViewHref } from "#/modules/plugins/catalog/location";
import { settingsGroups } from "#/modules/settings/sections";
import { navigationViewHref } from "#/modules/shell/sidebar-sections";

export const SEARCH_DEBOUNCE_MS = 120;
export const COMMIT_BUDGET_MS = 450;
const LIBRARY_HITS_PER_VIEW = 8;
const TOP_RESULT_LIMIT = 5;
const PAGE_PREVIEW_LIMIT = 3;

type Translate = (message: Message) => Text;

export const ALL_FILTER = "all";
export const PAGES_FILTER = "pages";

export type ViewOutcome = Result.Result<LibrarySearchResult, "failed">;

export type CommandFilter = {
	readonly key: string;
	readonly label: Text;
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
	readonly reference: SavedViewReference;
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
	readonly t: Translate;
	readonly navigation: NavigationData;
	readonly catalog: PluginClientCatalog;
}): readonly CommandOption[] => {
	const { t } = input;
	const group = t(kernelMessage("client.command-center.go-to"));
	const settings = t(kernelMessage("client.settings.title"));
	return [
		...input.navigation.savedViews
			.filter((view) => !view.isHidden)
			.map((view) => ({
				group,
				icon: view.icon,
				href: navigationViewHref(view),
				id: `view:${navigationViewHref(view)}`,
				label: formatDisplayText(t, view.name),
			})),
		...input.navigation.collections.map((collection) => ({
			group,
			icon: collection.icon,
			label: collection.name,
			id: `collection:${collection.slug}`,
			href: `/e/${encodeURIComponent(collection.slug)}`,
		})),
		...input.catalog
			.filter(({ health, isHidden }) => health === "ready" && !isHidden)
			.map((plugin) => ({
				group,
				icon: plugin.icon,
				label: t(plugin.name),
				href: pluginPath(plugin.packageId),
				id: `plugin:${plugin.installationId}`,
				description: t(kernelMessage("client.shell.sidebar.workspace")),
			})),
		{
			group,
			href: "/assistant",
			icon: "message-circle",
			id: "kernel:assistant",
			label: t(kernelMessage("client.route.assistant.conversations", { name: ASSISTANT_NAME })),
		},
		{ group, label: settings, icon: "settings", href: "/settings", id: "kernel:settings" },
		...settingsGroups.flatMap((settingsGroup) =>
			settingsGroup.sections.map((section) => ({
				group,
				icon: section.icon,
				href: section.path,
				description: settings,
				id: `settings:${section.slug}`,
				label: formatDisplayText(t, section.label),
			})),
		),
		{
			group,
			href: "/customize-sidebar",
			icon: "sliders-horizontal",
			id: "kernel:customize-sidebar",
			label: t(kernelMessage("client.shell.customize.title")),
		},
	];
};

export const filterOptions = (options: readonly CommandOption[], query: string) =>
	query.trim() === "" ? options : options.filter(({ label }) => matchesText(label, query));

export const libraryViews = (
	records: readonly SavedViewRecord[],
	t: Translate,
): readonly LibraryView[] =>
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
			settings.success.controls?.search === undefined ||
			!("librarySearch" in dataSources.queries)
		) {
			return [];
		}
		return [
			{
				href,
				dataSources,
				id: record.id,
				icon: record.icon,
				settings: settings.success,
				reference: record.reference,
				name: formatDisplayText(t, record.name),
				providerAdd: settings.success.addAction?.type === "provider-search",
			},
		];
	});

type LibraryExecute<Failure> = (request: PluginExecutionRequest) => Effect.Effect<unknown, Failure>;
const searchLibraryView = <Failure>(
	view: LibraryView,
	query: string,
	execute: LibraryExecute<Failure>,
): Effect.Effect<LibrarySearchResult, Failure | RyotClientError> =>
	Effect.gen(function* () {
		const search = view.settings.controls?.search;
		if (search === undefined) {
			return yield* new RyotClientError({ reason: "invalid-input" });
		}
		const argumentsValue = { [search]: query };
		const results = yield* Effect.all(
			{
				count: execute({
					arguments: argumentsValue,
					source: { kind: "savedView", reference: view.reference, query: "librarySearchCount" },
				}),
				hits: execute({
					arguments: argumentsValue,
					pages: { librarySearch: { limit: LIBRARY_HITS_PER_VIEW } },
					source: { kind: "savedView", query: "librarySearch", reference: view.reference },
				}),
			},
			{ concurrency: 2 },
		);
		const decoded = decodeLibrarySearch(
			results.hits,
			results.count,
			view.settings.summary.subtitle?.displayKind ?? null,
		);
		return Result.isFailure(decoded)
			? yield* new RyotClientError({ reason: "malformed-result" })
			: decoded.success;
	});

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

const providerOption = (t: Translate, view: LibraryView, query: string): CommandOption => ({
	icon: "plus",
	id: `add:${view.id}`,
	description: view.name,
	group: t(kernelMessage("client.command-center.actions")),
	label: t(kernelMessage("client.command-center.search-providers", { query })),
	href: `${view.href}?${new URLSearchParams({ q: query, add: "true" }).toString()}`,
});

type DisplayValueText = (value: SavedViewDisplayValue) => string;

const hitOption = (
	displayValue: DisplayValueText,
	view: LibraryView,
	hit: LibrarySearchHit,
): CommandOption => {
	const subtitle = hit.subtitle === null ? "" : displayValue(hit.subtitle);
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
	readonly t: Translate;
	readonly recents: readonly CommandOption[];
	readonly destinations: readonly CommandOption[];
}): readonly CommandGroup[] =>
	[
		{
			key: "recents",
			options: input.recents,
			heading: input.t(kernelMessage("client.command-center.recent")),
		},
		{
			key: "go-to",
			options: input.destinations,
			heading: input.t(kernelMessage("client.command-center.go-to")),
		},
	].filter(({ options }) => options.length > 0);

export const commandResults = (input: {
	readonly t: Translate;
	readonly filter: string;
	readonly commit: LibraryCommit;
	readonly displayValue: DisplayValueText;
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
	const pagesHeading = input.t(kernelMessage("client.settings.section.pages"));
	const actionsHeading = input.t(kernelMessage("client.command-center.actions"));
	const filters: readonly CommandFilter[] = [
		{ key: ALL_FILTER, label: input.t(kernelMessage("client.command-center.all")) },
		...found.map(({ view, result }) => ({
			key: view.id,
			count: result.total,
			label: formatDisplayText(input.t, view.name),
		})),
		...(pages.length > 0 ? [{ key: PAGES_FILTER, count: pages.length, label: pagesHeading }] : []),
	];
	const filter = filters.some(({ key }) => key === input.filter) ? input.filter : ALL_FILTER;
	if (filter === PAGES_FILTER) {
		return {
			filter,
			failed,
			filters,
			empty: false,
			groups: [{ key: "pages", options: pages, heading: pagesHeading }],
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
					options: scoped.result.hits.map((hit) => hitOption(input.displayValue, scoped.view, hit)),
				},
				...(scoped.view.providerAdd
					? [
							{
								key: "actions",
								heading: actionsHeading,
								options: [providerOption(input.t, scoped.view, query)],
							},
						]
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
			count: found.reduce((total, { result }) => total + result.total, 0),
			heading: input.t(kernelMessage("client.command-center.top-results")),
			options: top.map(({ hit, view }) => hitOption(input.displayValue, view, hit)),
		},
		{ key: "pages", heading: pagesHeading, options: pages.slice(0, PAGE_PREVIEW_LIMIT) },
		{
			key: "actions",
			heading: actionsHeading,
			options: providerView === undefined ? [] : [providerOption(input.t, providerView, query)],
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
