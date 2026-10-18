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
import type { EntityBrowserResult } from "@ryot-app/ryotql-recipes/saved-views";
import { Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";

import {
	destinationOptions,
	filterOptions,
	LIBRARY_VIEWS_KEY,
	type LibraryGroupResult,
	libraryGroups,
	type LibraryView,
	libraryViews,
	providerAddOptions,
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

const result = (...names: readonly string[]): EntityBrowserResult => ({
	pageInfo: { limit: 5, hasMore: false, nextCursor: null },
	items: names.map((name) => ({
		name,
		cells: [],
		presentation: null,
		ownerPluginId: null,
		entityId: `id-${name}`,
		entitySchemaSlug: "item",
		sync: {
			translationStatus: { state: "idle", availability: "none" },
			populationStatus: { state: "succeeded", availability: "complete" },
		},
	})),
});

const views = (): readonly LibraryView[] => libraryViews([record("a"), record("b")]);

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

	it("offers a provider search action carrying the query only for provider-add views", () => {
		const found = libraryViews([
			record("plain"),
			record("adder", { settings: { ...settings, addAction: providerAction } }),
		]);
		const options = providerAddOptions(found, "dune 2", new Set());

		expect(options).toHaveLength(1);
		expect(options[0]).toMatchObject({
			description: "View adder",
			href: "/v/c/adder?q=dune+2&add=true",
			label: 'Search providers for "dune 2"',
		});
	});

	it("ranks provider actions for views with library matches first and caps them at three", () => {
		const found = libraryViews(
			["a", "b", "c", "d"].map((slug) =>
				record(slug, { settings: { ...settings, addAction: providerAction } }),
			),
		);
		const matched = new Set([found[3]?.id ?? ""]);
		const options = providerAddOptions(found, "dune", matched);

		expect(options.map(({ description }) => description)).toEqual(["View d", "View a", "View b"]);
	});

	it("reports loading and failed library views as their own group instead of no matches", () => {
		expect(libraryGroups({ status: "pending" }, () => undefined)).toEqual([
			{ options: [], status: "pending", heading: "Library", key: LIBRARY_VIEWS_KEY },
		]);
		expect(libraryGroups({ status: "failed" }, () => undefined)).toEqual([
			{ options: [], status: "failed", heading: "Library", key: LIBRARY_VIEWS_KEY },
		]);
	});

	it("groups each loaded view by its search result", () => {
		const loaded = libraryViews([record("a"), record("b"), record("c")]);
		const results = new Map<string, LibraryGroupResult>([
			["a", Result.succeed([])],
			["b", Result.fail("failed")],
		]);

		expect(
			libraryGroups({ views: loaded, status: "ready" }, (view) => results.get(view.id)).map(
				({ key, status }) => [key, status],
			),
		).toEqual([
			["a", "ready"],
			["b", "failed"],
			["c", "pending"],
		]);
	});
});

describe("command center library search", () => {
	it.effect("waits for the debounce, then limits each view to three rows", () =>
		Effect.gen(function* () {
			const seen: string[] = [];
			const groups = new Map<string, LibraryGroupResult>();
			const fiber = yield* Effect.forkChild(
				runLibrarySearch({
					query: "du",
					views: views(),
					onGroup: (id, group) => groups.set(id, group),
					execute: () =>
						Effect.sync(() => {
							seen.push("query");
							return result("one", "two", "three", "four", "five");
						}),
				}),
			);

			yield* TestClock.adjust(SEARCH_DEBOUNCE_MS - 1);
			expect(seen).toEqual([]);
			yield* TestClock.adjust(1);
			yield* Fiber.join(fiber);

			expect(seen).toHaveLength(2);
			const first = groups.get("a");
			expect(
				first && Result.isSuccess(first) ? first.success.map(({ label }) => label) : [],
			).toEqual(["one", "two", "three"]);
			expect(first && Result.isSuccess(first) ? first.success[0]?.href : "").toBe("/e/id-one");
		}),
	);

	it.effect("cancels a superseded search before it queries", () =>
		Effect.gen(function* () {
			let queries = 0;
			const stale = yield* Effect.forkChild(
				runLibrarySearch({
					query: "d",
					views: views(),
					onGroup: () => undefined,
					execute: () =>
						Effect.sync(() => {
							queries += 1;
							return result("x");
						}),
				}),
			);
			yield* TestClock.adjust(100);
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
					onGroup: () => undefined,
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
			const groups = new Map<string, LibraryGroupResult>();
			const fiber = yield* Effect.forkChild(
				runLibrarySearch({
					query: "d",
					views: views(),
					onGroup: (id, group) => groups.set(id, group),
					execute: () => {
						calls += 1;
						return calls === 1 ? Effect.fail("boom") : Effect.succeed(result("ok"));
					},
				}),
			);
			yield* TestClock.adjust(SEARCH_DEBOUNCE_MS);
			yield* Fiber.join(fiber);

			const outcomes = [...groups.values()].map((group) => Result.isFailure(group));
			expect(outcomes).toHaveLength(2);
			expect(outcomes.filter(Boolean)).toHaveLength(1);
		}),
	);
});
