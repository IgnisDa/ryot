import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	type ListedSavedView,
	SavedViewBadRequest,
	type SavedViewLayouts,
} from "@ryot-app/contract/modules/saved-views/schemas";
import {
	EntitySchemaSlug,
	PluginSlug,
	SavedViewId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { ascending, column, document, field, rows, table } from "@ryot-app/ryotql";
import { Effect, Layer } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import { databaseLayer, type MockOverrides } from "#lib/test-utils/effect";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";

import { ClientPagesRepository } from "../client-pages/repository";
import { SavedViewsRepository } from "./repository";
import { SavedViewsService } from "./service";

const user = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const record = table("entity", "record");
const queryDocument = document({
	savedView: rows(record, {
		orderBy: [ascending(column(record, "name"))],
		fields: [field("id", column(record, "id")), field("name", column(record, "name"))],
	}),
});
const cardLayout = {
	queryDocument,
	imageField: null,
	titleField: "name",
	callout: null,
	entityIdField: "id",
	overline: null,
	primaryMetadata: null,
	secondaryMetadata: null,
} as const;
const layouts = {
	grid: cardLayout,
	list: cardLayout,
	table: {
		queryDocument,
		imageField: null,
		entityIdField: "id",
		columns: [{ label: "Name", field: "name", displayKind: "text" }],
	},
} satisfies SavedViewLayouts;

const baseView = {
	layouts,
	sortOrder: 0,
	icon: "record",
	slug: "my-view",
	name: "My View",
	pluginSlug: null,
	isBuiltin: false,
	isDisabled: false,
	entitySchemaSlug: null,
	pluginInstallationId: null,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	id: SavedViewId.make("sv-id"),
} satisfies ListedSavedView & { readonly pluginInstallationId: string | null };
const createBody = { layouts, icon: "record", name: "My View", entitySchemaSlug: null };
const browserSettings = {
	pageSize: 20,
	addAction: null,
	sortChoices: [],
	searchFields: [],
	tableColumns: null,
	defaultLayout: "grid",
	sourceName: "entities",
	layouts: ["grid", "list"],
	entityIdField: "entityId",
	ownerPluginIdField: "ownerPluginId",
	entitySchemaSlugField: "entitySchemaSlug",
} as const;
const browserDataSources = document({
	entities: rows(record, {
		fields: [
			field("entityId", column(record, "id")),
			field("ownerPluginId", column(record, "entitySchemaPluginId")),
			field("entitySchemaSlug", column(record, "entitySchemaSlug")),
		],
	}),
});
const mockRepository = Layer.mock(SavedViewsRepository);
const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ ...overrides });
const requireLegacyLayouts = (view: ListedSavedView): SavedViewLayouts => {
	if (view.layouts === undefined) {
		throw new Error(`Expected legacy layouts for ${view.slug}`);
	}
	return view.layouts;
};
const makeDefinitionRegistryLayer = (...views: ReadonlyArray<ListedSavedView>) => {
	const registry = makeDefinitionRegistry({
		entitySchemas: [],
		signalSchemas: [],
		relationshipSchemas: [],
		savedViews: views.map((view) => ({
			icon: view.icon,
			name: view.name,
			slug: view.slug,
			sortOrder: view.sortOrder,
			pluginSlug: view.pluginSlug,
			layouts: requireLegacyLayouts(view),
			entitySchemaSlug: view.entitySchemaSlug,
		})),
	});
	return Layer.mergeAll(
		Layer.succeed(DefinitionRegistry, registry),
		Layer.mock(PluginRuntimeResolver)({
			listPluginsAvailableToUser: () => Effect.succeed([]),
			getEffectiveDefinitions: () => Effect.succeed(registry.getSnapshot()),
		}),
	);
};
const makeServiceLayer = (
	repository = makeRepository(),
	definitionRegistry = makeDefinitionRegistryLayer(),
) =>
	SavedViewsService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				definitionRegistry,
				repository,
				ClientPagesRepository.layer,
				Layer.mock(PluginInstallationRepository)({ listForUser: () => Effect.succeed([]) }),
			),
		),
	);

it.effect("creates and clones saved views without changing layouts", () => {
	let findCalls = 0;
	const createdLayouts: SavedViewLayouts[] = [];
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(findCalls++ === 1 ? baseView : null),
			create: (_userId, input) =>
				Effect.sync(() => {
					if (input.layouts === undefined) {
						throw new Error("Expected legacy layouts");
					}
					createdLayouts.push(input.layouts);
					return { ...baseView, name: input.name, slug: input.slug, layouts: input.layouts };
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const created = yield* service.create(user, createBody);
		const cloned = yield* service.clone(user, "my-view");

		expect(created.layouts).toEqual(layouts);
		expect(cloned.name).toBe("My View (Copy)");
		expect(createdLayouts).toEqual([layouts, layouts]);
	}).pipe(Effect.provide(layer));
});

it.effect("creates an entity-browser view through the kernel renderer path", () => {
	let storedRenderer: ListedSavedView["renderer"];
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(null),
			create: (_userId, input) =>
				Effect.sync(() => {
					storedRenderer = input.renderer;
					return {
						...baseView,
						layouts: undefined,
						renderer: input.renderer,
						settings: input.settings,
						dataSources: input.dataSources,
					};
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const renderer = { kind: "kernel", name: "entity-browser" } as const;
		yield* service.create(user, {
			renderer,
			icon: "grid",
			name: "Entity Browser",
			settings: browserSettings,
			dataSources: browserDataSources,
		});

		expect(storedRenderer).toEqual(renderer);
	}).pipe(Effect.provide(layer));
});

it.effect("creates a results-table view through the kernel renderer path", () => {
	let storedRenderer: ListedSavedView["renderer"];
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(null),
			create: (_userId, input) =>
				Effect.sync(() => {
					storedRenderer = input.renderer;
					return {
						...baseView,
						layouts: undefined,
						renderer: input.renderer,
						settings: input.settings,
						dataSources: input.dataSources,
					};
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const renderer = { kind: "kernel", name: "results-table" } as const;
		yield* service.create(user, {
			renderer,
			icon: "table",
			name: "Results",
			dataSources: browserDataSources,
			settings: {
				pageSize: 20,
				sourceName: "entities",
				rowKeyFields: ["entityId"],
				entityLink: { entityIdField: "entityId" },
				columns: [{ label: "Schema", field: "entitySchemaSlug", displayKind: "text" }],
			},
		});

		expect(storedRenderer).toEqual(renderer);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects built-in layout changes but permits state updates", () => {
	const builtin = { ...baseView, isBuiltin: true };
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(builtin),
			updateBuiltinStateBySlug: (_userId, _slug, isDisabled, sortOrder) =>
				Effect.succeed({ ...builtin, isDisabled, sortOrder }),
		}),
		makeDefinitionRegistryLayer(builtin),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const updated = yield* service.update(user, builtin.slug, {
			isDisabled: true,
			icon: builtin.icon,
			name: builtin.name,
		});
		const exit = yield* Effect.exit(
			service.update(user, builtin.slug, {
				...createBody,
				isDisabled: false,
				layouts: { ...layouts, grid: { ...layouts.grid, titleField: "id" } },
			}),
		);
		const entitySchemaExit = yield* Effect.exit(
			service.update(user, builtin.slug, {
				...createBody,
				isDisabled: false,
				entitySchemaSlug: EntitySchemaSlug.make("record"),
			}),
		);

		expect(updated.isDisabled).toBe(true);
		expect(updated.layouts).toEqual(builtin.layouts);
		assertExitFails(
			exit,
			new SavedViewBadRequest({
				reason: { code: "builtin-view-immutable", viewSlug: builtin.slug },
			}),
		);
		assertExitFails(
			entitySchemaExit,
			new SavedViewBadRequest({
				reason: { code: "builtin-view-immutable", viewSlug: builtin.slug },
			}),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("preserves omitted layouts when updating a non-built-in view", () => {
	let stored: ListedSavedView | undefined;
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(baseView),
			updateBySlug: (_userId, _slug, data, _currentPluginInstallationId) =>
				Effect.sync(() => {
					const updated = {
						...baseView,
						icon: data.icon,
						name: data.name,
						isDisabled: data.isDisabled,
						layouts: data.layouts ?? baseView.layouts,
						pluginInstallationId: data.pluginInstallationId,
						sortOrder: data.sortOrder ?? baseView.sortOrder,
						pluginSlug: data.pluginInstallationId ? PluginSlug.make("private-plugin") : null,
						entitySchemaSlug:
							data.entitySchemaSlug === undefined
								? baseView.entitySchemaSlug
								: data.entitySchemaSlug,
					};
					stored = updated;
					return updated;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const updated = yield* service.update(user, baseView.slug, {
			icon: "heart",
			isDisabled: true,
			name: "Updated View",
		});

		expect(updated).toMatchObject({
			layouts,
			icon: "heart",
			isDisabled: true,
			name: "Updated View",
		});
		expect(stored?.layouts).toEqual(layouts);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects unknown entity schemas on create and update", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: (_userId, slug) => Effect.succeed(slug === "my-view" ? baseView : null),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const createExit = yield* Effect.exit(
			service.create(user, {
				...createBody,
				slug: "new-view",
				entitySchemaSlug: EntitySchemaSlug.make("missing"),
			}),
		);
		const updateExit = yield* Effect.exit(
			service.update(user, "my-view", {
				...createBody,
				isDisabled: false,
				entitySchemaSlug: EntitySchemaSlug.make("missing"),
			}),
		);

		const expected = new SavedViewBadRequest({
			reason: {
				code: "entity-schema-not-found",
				entitySchemaSlug: EntitySchemaSlug.make("missing"),
			},
		});
		assertExitFails(createExit, expected);
		assertExitFails(updateExit, expected);
	}).pipe(Effect.provide(layer));
});

it.effect("reorders through one repository operation without rewriting definitions", () => {
	const views = [
		{ ...baseView, slug: "view-a", sortOrder: 0 },
		{ ...baseView, slug: "view-b", sortOrder: 1 },
	];
	const reorders: Array<{ pluginInstallationId: string | null; viewSlugs: ReadonlyArray<string> }> =
		[];
	let updateCalls = 0;
	const layer = makeServiceLayer(
		makeRepository({
			listByUser: () => Effect.succeed(views),
			updateBySlug: () => Effect.sync(() => (updateCalls++, baseView)),
			reorderBySlugs: (_userId, pluginInstallationId, viewSlugs) =>
				Effect.sync(() => {
					reorders.push({ pluginInstallationId, viewSlugs });
					return viewSlugs.length;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		expect(yield* service.reorder(user, { viewSlugs: ["view-b", "view-a"] })).toEqual({
			viewSlugs: ["view-b", "view-a"],
		});
		expect(reorders).toEqual([{ pluginInstallationId: null, viewSlugs: ["view-b", "view-a"] }]);
		expect(updateCalls).toBe(0);
	}).pipe(Effect.provide(layer));
});

it.effect("reorders only saved views in the requested scope", () => {
	const views = [
		{ ...baseView, slug: "global-a", sortOrder: 0 },
		{ ...baseView, slug: "global-b", sortOrder: 1 },
		{ ...baseView, sortOrder: 0, slug: "plugin-a-view", pluginSlug: PluginSlug.make("plugin-a") },
	];
	const reorders: Array<ReadonlyArray<string>> = [];
	const layer = makeServiceLayer(
		makeRepository({
			listByUser: () => Effect.succeed(views),
			reorderBySlugs: (_userId, _pluginInstallationId, viewSlugs) =>
				Effect.sync(() => {
					reorders.push(viewSlugs);
					return viewSlugs.length;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		expect(yield* service.reorder(user, { viewSlugs: ["global-b", "global-a"] })).toEqual({
			viewSlugs: ["global-b", "global-a"],
		});
		expect(reorders).toEqual([["global-b", "global-a"]]);
	}).pipe(Effect.provide(layer));
});

it.effect("fails the whole reorder when a scoped view disappears before the write", () => {
	const layer = makeServiceLayer(
		makeRepository({
			reorderBySlugs: () => Effect.succeed(1),
			listByUser: () =>
				Effect.succeed([
					{ ...baseView, slug: "view-a", sortOrder: 0 },
					{ ...baseView, slug: "view-b", sortOrder: 1 },
				]),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(service.reorder(user, { viewSlugs: ["view-b", "view-a"] }));
		assertExitFails(
			exit,
			new SavedViewBadRequest({
				reason: {
					issue: "update-failed",
					code: "invalid-reorder",
					viewSlugs: ["view-b", "view-a"],
				},
			}),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("persists builtin layouts unchanged", () => {
	let builtinLayouts: SavedViewLayouts | undefined;
	let builtinEntitySchemaSlug: ListedSavedView["entitySchemaSlug"] = null;
	const layer = makeServiceLayer(
		makeRepository({
			ensureBuiltinViews: (_userId, views) =>
				Effect.sync(() => {
					const view = views[0];
					if (!view) {
						throw new Error("Expected a built-in saved view");
					}
					builtinLayouts = view.layouts;
					builtinEntitySchemaSlug = view.entitySchemaSlug ?? null;
				}),
		}),
		makeDefinitionRegistryLayer({ ...baseView, isBuiltin: true }),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		yield* service.ensureBuiltinViews(user.id);
		expect(builtinLayouts).toEqual(layouts);
		expect(builtinEntitySchemaSlug).toBeNull();
	}).pipe(Effect.provide(layer));
});

it.effect("persists exact private plugin ownership for builtin and custom views", () => {
	const updatedViews: unknown[] = [];
	const installedViews: unknown[] = [];
	const pluginId = "private-plugin-id";
	const includeUnavailableCalls: boolean[] = [];
	const installationId = "private-installation-id";
	const definitions = makeDefinitionRegistry({
		signalSchemas: [],
		relationshipSchemas: [],
		entitySchemas: [
			{
				pluginId,
				icon: "record",
				name: "Record",
				slug: "record",
				eventSchemas: [],
				pluginSlug: "private-plugin",
				propertiesSchema: { fields: {} },
			},
		],
		savedViews: [
			{
				layouts,
				pluginId,
				sortOrder: 0,
				icon: "record",
				slug: "plugin-view",
				name: "Plugin View",
				entitySchemaSlug: "record",
				pluginSlug: "private-plugin",
			},
		],
	}).getSnapshot();
	const layer = SavedViewsService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				makeDefinitionRegistryLayer(),
				makeRepository({
					findBySlug: () => Effect.succeed(baseView),
					ensureBuiltinViews: (_userId, views) =>
						Effect.sync(() => void installedViews.push(...views)),
					updateBySlug: (_userId, _slug, data, _currentPluginInstallationId) =>
						Effect.sync(() => {
							updatedViews.push(data);
							return {
								...baseView,
								icon: data.icon,
								name: data.name,
								isDisabled: data.isDisabled,
								layouts: data.layouts ?? baseView.layouts,
								pluginInstallationId: data.pluginInstallationId,
								sortOrder: data.sortOrder ?? baseView.sortOrder,
								pluginSlug: data.pluginInstallationId ? PluginSlug.make("private-plugin") : null,
								entitySchemaSlug:
									data.entitySchemaSlug === undefined
										? baseView.entitySchemaSlug
										: data.entitySchemaSlug,
							};
						}),
				}),
				Layer.mock(PluginRuntimeResolver)({
					listPluginsAvailableToUser: () =>
						Effect.succeed([
							{
								config: {},
								id: pluginId,
								scope: "user",
								installationId,
								health: "ready",
								isDisabled: false,
								compiledHashes: {},
								slug: "private-plugin",
								sourceHash: "source-hash",
								manifest: fixtureManifest(),
							},
						]),
					getEffectiveDefinitions: (_userId, includeUnavailable) => {
						includeUnavailableCalls.push(includeUnavailable ?? false);
						return Effect.succeed(definitions);
					},
				}),
				Layer.mock(PluginInstallationRepository)({
					listForUser: () =>
						Effect.succeed([
							{
								pluginId,
								config: {},
								sortOrder: 0,
								health: "ready",
								userId: user.id,
								isDisabled: false,
								healthReason: null,
								id: installationId,
								pluginScope: "user",
								pluginSlug: "private-plugin",
								createdAt: new Date(0),
								updatedAt: new Date(0),
							},
						]),
				}),
				ClientPagesRepository.layer,
			),
		),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		yield* service.ensureBuiltinViews(user.id);
		yield* service.update(user, baseView.slug, {
			...createBody,
			isDisabled: false,
			pluginSlug: PluginSlug.make("private-plugin"),
			entitySchemaSlug: EntitySchemaSlug.make("record"),
		});
		expect(installedViews).toMatchObject([
			{ pluginInstallationId: installationId, entitySchemaPluginId: pluginId },
		]);
		expect(includeUnavailableCalls).toContain(true);
		expect(updatedViews).toMatchObject([
			{
				entitySchemaSlug: "record",
				entitySchemaPluginId: pluginId,
				pluginInstallationId: installationId,
			},
		]);
	}).pipe(Effect.provide(layer));
});
