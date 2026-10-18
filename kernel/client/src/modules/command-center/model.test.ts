import { describe, expect, it } from "@effect/vitest";
import {
	EntitySchemaSlug,
	PluginId,
	PluginPackageId,
	SavedViewId,
} from "@ryot-app/contract/schema/brands";
import { aggregate, ascending, column, document, field, rows, table } from "@ryot-app/ryotql";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import type { SavedViewRecord } from "@ryot-app/ryotql-recipes/saved-view-records";
import type { LibrarySearchHit, LibrarySearchResult } from "@ryot-app/ryotql-recipes/saved-views";
import { Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";

import {
	ALL_FILTER,
	commandResults,
	COMMIT_BUDGET_MS,
	destinationOptions,
	filterOptions,
	type LibraryCommit,
	type LibraryView,
	libraryViews,
	PAGES_FILTER,
	runLibrarySearch,
	SEARCH_DEBOUNCE_MS,
} from "#/modules/command-center/model";

const entity = table("entity", "entity");

const dataSources = document({
	ignored: aggregate(entity, { measures: [{ key: "total", aggregation: { function: "count" } }] }),
	selection: rows(entity, {
		limit: 40,
		orderBy: [ascending(column(entity, "createdAt"))],
		fields: [field("nameAlias", column(entity, "name"))],
	}),
});

const settings = {
	pageSize: 20,
	sortChoices: [],
	addAction: null,
	tableColumns: null,
	defaultLayout: "grid",
	sourceName: "selection",
	layouts: ["grid", "list"],
	searchFields: ["nameAlias"],
	summary: { image: null, subtitle: null },
	subject: {
		entityAlias: "entity",
		schemas: [{ owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("item") }],
	},
} as const;

const providerAction = {
	type: "provider-search",
	library: { librarySchemaSlug: "library", relationshipSlug: "in-library" },
	schema: { owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("item") },
} as const;

const record = (
	id: string,
	overrides: Partial<SavedViewRecord> & { readonly settings?: SavedViewRecord["settings"] } = {},
): SavedViewRecord => ({
	slug: id,
	settings,
	dataSources,
	icon: "list",
	sortOrder: 0,
	isHidden: false,
	packageId: null,
	createdAt: null,
	updatedAt: null,
	isBuiltin: false,
	name: `View ${id}`,
	id: SavedViewId.make(id),
	renderer: { kind: "kernel", name: "entity-browser" },
	reference: { kind: "custom", savedViewId: SavedViewId.make(id) },
	...overrides,
});

const navigation: NavigationData = {
	collections: [
		{
			sortOrder: 0,
			slug: "col-1",
			reference: null,
			isHidden: false,
			packageId: null,
			icon: "layers-3",
			name: "Favorites",
			pluginInstallationId: null,
		},
	],
	savedViews: [
		{
			icon: "list",
			sortOrder: 0,
			slug: "queue",
			name: "Queue",
			isHidden: false,
			packageId: null,
			pluginInstallationId: null,
			reference: { slug: "queue", kind: "kernel" },
		},
		{
			icon: "list",
			sortOrder: 1,
			slug: "secret",
			isHidden: true,
			name: "Secret",
			packageId: null,
			pluginInstallationId: null,
			reference: { kind: "kernel", slug: "secret" },
		},
	],
};

const catalog: PluginClientCatalog = [
	{
		sortOrder: 0,
		icon: "film",
		scope: "system",
		name: "Fixture",
		health: "ready",
		isHidden: false,
		clientApiVersion: 1,
		homeSavedView: null,
		contentHash: "hash",
		clientEntities: null,
		installationId: "installation-1",
		pluginId: PluginId.make("plugin-1"),
		packageId: PluginPackageId.make("test/plugin-1"),
	},
	{
		sortOrder: 1,
		icon: "film",
		name: "Hidden",
		isHidden: true,
		scope: "system",
		health: "ready",
		clientApiVersion: 1,
		homeSavedView: null,
		contentHash: "hash",
		clientEntities: null,
		installationId: "installation-2",
		pluginId: PluginId.make("plugin-2"),
		packageId: PluginPackageId.make("test/plugin-2"),
	},
];

const hit = (name: string, rank = 2, extra: Partial<LibrarySearchHit> = {}): LibrarySearchHit => ({
	rank,
	name,
	image: null,
	subtitle: null,
	entityId: `id-${name}`,
	...extra,
});

const searchResult = (...hits: readonly LibrarySearchHit[]): LibrarySearchResult => ({
	hits,
	total: hits.length,
});

const views = (): readonly LibraryView[] => libraryViews([record("a"), record("b")]);

const adders = (): readonly LibraryView[] =>
	libraryViews([
		record("shows", { settings: { ...settings, addAction: providerAction } }),
		record("books"),
		record("movies", { settings: { ...settings, addAction: providerAction } }),
	]);

const commitOf = (
	query: string,
	outcomes: readonly (readonly [undefined | LibraryView, "failed" | LibrarySearchResult])[],
): LibraryCommit => ({
	query,
	complete: true,
	outcomes: outcomes.flatMap(([view, outcome]) =>
		view === undefined
			? []
			: [{ view, outcome: outcome === "failed" ? Result.fail("failed") : Result.succeed(outcome) }],
	),
});

const groupLabels = (commit: LibraryCommit, filter = ALL_FILTER) =>
	commandResults({ commit, filter, destinations: [] }).groups.map(({ heading, options }) => [
		heading,
		options.map(({ label }) => label),
	]);

describe("command center destinations", () => {
	it("lists visible views, collections, visible workspaces, and kernel pages", () => {
		const options = destinationOptions({ catalog, navigation });
		const labels = options.map(({ label }) => label);

		expect(labels).toEqual(expect.arrayContaining(["Queue", "Favorites", "Fixture", "Settings"]));
		expect(labels).toEqual(expect.arrayContaining(["Preferences", "Backups", "Customize sidebar"]));
		expect(labels).not.toContain("Secret");
		expect(labels).not.toContain("Hidden");
		expect(options.find(({ label }) => label === "Favorites")?.href).toBe("/e/col-1");
		expect(options.find(({ label }) => label === "Fixture")?.href).toBe("/p/test/plugin-1");
		expect(options.find(({ label }) => label === "Queue")?.href).toBe("/v/k/queue");
	});

	it("matches case-insensitively by substring", () => {
		const options = destinationOptions({ catalog, navigation });

		expect(filterOptions(options, "  BACK").map(({ label }) => label)).toEqual(["Backups"]);
		expect(filterOptions(options, "")).toHaveLength(options.length);
		expect(filterOptions(options, "zzzz")).toEqual([]);
	});
});

describe("command center library views", () => {
	it("keeps only visible, searchable entity browsers with valid settings", () => {
		const found = libraryViews([
			record("keep"),
			record("hidden", { isHidden: true }),
			record("table", { renderer: { kind: "kernel", name: "results-table" } }),
			record("no-sources", { dataSources: null }),
			record("no-search", { settings: { ...settings, searchFields: [] } }),
			record("broken", { settings: { nope: true } }),
		]);

		expect(found.map(({ id }) => id)).toEqual(["keep"]);
		expect(found[0]?.href).toBe("/v/c/keep");
	});
});

describe("command center library search", () => {
	it.effect("waits for the debounce, then commits every settled view at once", () =>
		Effect.gen(function* () {
			let queries = 0;
			const commits: LibraryCommit[] = [];
			const fiber = yield* Effect.forkChild(
				runLibrarySearch({
					query: "du",
					views: views(),
					onCommit: (commit) => commits.push(commit),
					execute: () =>
						Effect.sync(() => {
							queries += 1;
							return searchResult(hit("Dune"));
						}),
				}),
			);

			yield* TestClock.adjust(SEARCH_DEBOUNCE_MS - 1);
			expect(queries).toBe(0);
			yield* TestClock.adjust(1);
			yield* Fiber.join(fiber);

			expect(queries).toBe(2);
			expect(commits.map(({ complete, outcomes }) => [complete, outcomes.length])).toEqual([
				[true, 2],
			]);
		}),
	);

	it.effect("commits settled views at the budget and appends late views below them", () =>
		Effect.gen(function* () {
			let calls = 0;
			const commits: LibraryCommit[] = [];
			const fiber = yield* Effect.forkChild(
				runLibrarySearch({
					query: "du",
					views: views(),
					onCommit: (commit) => commits.push(commit),
					execute: () => {
						calls += 1;
						return calls === 1
							? Effect.sleep(COMMIT_BUDGET_MS * 2).pipe(Effect.as(searchResult(hit("Late"))))
							: Effect.succeed(searchResult(hit("Early")));
					},
				}),
			);

			yield* TestClock.adjust(SEARCH_DEBOUNCE_MS + COMMIT_BUDGET_MS - 1);
			expect(commits).toEqual([]);
			yield* TestClock.adjust(1);
			expect(
				commits.map(({ complete, outcomes }) => [complete, outcomes.map(({ view }) => view.id)]),
			).toEqual([[false, ["b"]]]);
			yield* TestClock.adjust(COMMIT_BUDGET_MS);
			yield* Fiber.join(fiber);

			expect(commits.at(-1)?.complete).toBe(true);
			expect(commits.at(-1)?.outcomes.map(({ view }) => view.id)).toEqual(["b", "a"]);
		}),
	);

	it.effect("cancels a superseded search before it queries", () =>
		Effect.gen(function* () {
			let queries = 0;
			const stale = yield* Effect.forkChild(
				runLibrarySearch({
					query: "d",
					views: views(),
					onCommit: () => undefined,
					execute: () =>
						Effect.sync(() => {
							queries += 1;
							return searchResult();
						}),
				}),
			);
			yield* TestClock.adjust(SEARCH_DEBOUNCE_MS - 1);
			yield* Fiber.interrupt(stale);
			yield* TestClock.adjust(SEARCH_DEBOUNCE_MS * 2);

			expect(queries).toBe(0);
		}),
	);

	it.effect("interrupts in-flight queries when the search is superseded", () =>
		Effect.gen(function* () {
			let interrupted = 0;
			const fiber = yield* Effect.forkChild(
				runLibrarySearch({
					query: "d",
					views: views(),
					onCommit: () => undefined,
					execute: () =>
						Effect.never.pipe(
							Effect.onInterrupt(() =>
								Effect.sync(() => {
									interrupted += 1;
								}),
							),
						),
				}),
			);
			yield* TestClock.adjust(SEARCH_DEBOUNCE_MS);
			yield* Effect.yieldNow;
			yield* Fiber.interrupt(fiber);

			expect(interrupted).toBe(2);
		}),
	);

	it.effect("reports a failing view without affecting the others", () =>
		Effect.gen(function* () {
			let calls = 0;
			const commits: LibraryCommit[] = [];
			const fiber = yield* Effect.forkChild(
				runLibrarySearch({
					query: "d",
					views: views(),
					onCommit: (commit) => commits.push(commit),
					execute: () => {
						calls += 1;
						return calls === 1 ? Effect.fail("boom") : Effect.succeed(searchResult(hit("ok")));
					},
				}),
			);
			yield* TestClock.adjust(SEARCH_DEBOUNCE_MS);
			yield* Fiber.join(fiber);

			expect(commits.at(-1)?.outcomes.map(({ outcome }) => Result.isFailure(outcome))).toEqual([
				true,
				false,
			]);
		}),
	);
});

describe("command center results", () => {
	it("ranks top results by match quality, then exact name, then view order", () => {
		const [shows, books, movies] = adders();
		const commit = commitOf("dark", [
			[shows, searchResult(hit("His Dark Materials", 1), hit("Dark", 0))],
			[books, searchResult(hit("Darkness", 0), hit("The Dark Prophecy", 1))],
			[movies, searchResult(hit("Dark City", 0), hit("Donnie Darko", 2))],
		]);

		expect(groupLabels(commit)).toEqual([
			["Top results", ["Dark", "Darkness", "Dark City", "His Dark Materials", "The Dark Prophecy"]],
			["Actions", ['Search providers for "dark"']],
		]);
	});

	it("offers one filter per view with matches plus pages, falling back to all", () => {
		const [shows, books] = adders();
		const commit = commitOf("dark", [
			[shows, searchResult(hit("Dark"))],
			[books, searchResult()],
		]);
		const destinations = destinationOptions({ catalog, navigation });
		const results = commandResults({
			destinations,
			filter: "gone",
			commit: { ...commit, query: "customize" },
		});

		expect(results.filter).toBe(ALL_FILTER);
		expect(results.filters.map(({ key, count }) => [key, count])).toEqual([
			[ALL_FILTER, undefined],
			["shows", 1],
			[PAGES_FILTER, 1],
		]);
		expect(
			commandResults({
				destinations,
				filter: PAGES_FILTER,
				commit: { ...commit, query: "customize" },
			}).groups.map(({ options }) => options.map(({ label }) => label)),
		).toEqual([["Customize sidebar"]]);
	});

	it("scopes results and the provider action to the chosen view", () => {
		const [shows, books] = adders();
		const commit = commitOf("dark", [
			[shows, searchResult(hit("Dark"), hit("Dark Matter"))],
			[books, searchResult(hit("Darkness"))],
		]);

		expect(groupLabels(commit, "shows")).toEqual([
			["View shows", ["Dark", "Dark Matter"]],
			["Actions", ['Search providers for "dark"']],
		]);
		expect(groupLabels(commit, "books")).toEqual([["View books", ["Darkness"]]]);
	});

	it("targets the provider action at the top hit's view and flags empty searches", () => {
		const [shows, books, movies] = adders();
		const withHit = commandResults({
			destinations: [],
			filter: ALL_FILTER,
			commit: commitOf("dune", [
				[shows, searchResult()],
				[books, searchResult()],
				[movies, searchResult(hit("Dune", 0))],
			]),
		});
		const nothing = commandResults({
			destinations: [],
			filter: ALL_FILTER,
			commit: commitOf("zzz", [
				[shows, searchResult()],
				[books, "failed"],
			]),
		});

		expect(withHit.groups.at(-1)?.options[0]?.href).toBe("/v/c/movies?q=dune&add=true");
		expect(withHit.empty).toBe(false);
		expect(nothing.empty).toBe(true);
		expect(nothing.failed.map(({ id }) => id)).toEqual(["books"]);
		expect(nothing.groups.map(({ options }) => options[0]?.description)).toEqual(["View shows"]);
	});

	it("describes hits with their subtitle and shows art only for views that declare an image", () => {
		const [plain] = adders();
		const [pictured] = libraryViews([
			record("pictured", {
				settings: { ...settings, summary: { image: "cover", subtitle: null } },
			}),
		]);
		const cover = { type: "remote", url: "https://example.com/dark.jpg" } as const;
		const subtitle = { value: 2017, displayKind: "year" } as const;
		const [option] =
			commandResults({
				destinations: [],
				filter: ALL_FILTER,
				commit: commitOf("dark", [
					[pictured, searchResult(hit("Dark", 0, { subtitle, image: cover }))],
					[plain, searchResult(hit("Darker", 2))],
				]),
			}).groups[0]?.options ?? [];

		expect(option).toMatchObject({
			href: "/e/id-Dark",
			description: "2017",
			tag: "View pictured",
			art: { image: cover },
		});
		expect(
			commandResults({
				destinations: [],
				filter: ALL_FILTER,
				commit: commitOf("dark", [[plain, searchResult(hit("Darker", 2))]]),
			}).groups[0]?.options[0]?.art,
		).toBeUndefined();
	});
});
