import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest } from "@ryot/contract/errors";
import type { ListedSavedView, SavedViewLayouts } from "@ryot/contract/modules/saved-views/schemas";
import { EntitySchemaSlug, PluginSlug, SavedViewId, UserId } from "@ryot/contract/schema/brands";
import { ascending, column, document, field, rows, table } from "@ryot/ryotql";
import { Effect, Layer } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import { databaseLayer, type MockOverrides } from "#lib/test-utils/effect";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";

import { SavedViewsRepository } from "./repository";
import { SavedViewsService } from "./service";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const book = table("entity", "book");
const queryDocument = document({
	savedView: rows(book, {
		orderBy: [ascending(column(book, "name"))],
		fields: [field("id", column(book, "id")), field("name", column(book, "name"))],
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

const baseView: ListedSavedView = {
	layouts,
	icon: "book",
	sortOrder: 0,
	slug: "my-view",
	name: "My View",
	pluginSlug: null,
	isBuiltin: false,
	isDisabled: false,
	entitySchemaSlug: null,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	id: SavedViewId.make("sv-id"),
};
const createBody = { layouts, icon: "book", name: "My View", entitySchemaSlug: null };
const mockRepository = Layer.mock(SavedViewsRepository);
const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ ...overrides });
const makeDefinitionRegistryLayer = (...views: ReadonlyArray<ListedSavedView>) =>
	Layer.succeed(
		DefinitionRegistry,
		makeDefinitionRegistry({
			entitySchemas: [],
			signalSchemas: [],
			relationshipSchemas: [],
			savedViews: views.map(
				({ icon, layouts: viewLayouts, name, pluginSlug, entitySchemaSlug, slug, sortOrder }) => ({
					icon,
					name,
					slug,
					sortOrder,
					pluginSlug,
					entitySchemaSlug,
					layouts: viewLayouts,
				}),
			),
		}),
	);
const makeServiceLayer = (
	repository = makeRepository(),
	definitionRegistry = makeDefinitionRegistryLayer(),
) =>
	SavedViewsService.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(databaseLayer, definitionRegistry, repository)),
	);

it.effect("creates and clones saved views without changing layouts", () => {
	let findCalls = 0;
	const createdLayouts: SavedViewLayouts[] = [];
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(findCalls++ === 1 ? baseView : null),
			create: (_userId, input) =>
				Effect.sync(() => {
					createdLayouts.push(input.layouts);
					return {
						...baseView,
						name: input.name,
						slug: input.slug,
						layouts: input.layouts,
					};
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
				entitySchemaSlug: EntitySchemaSlug.make("book"),
			}),
		);

		expect(updated.isDisabled).toBe(true);
		expect(updated.layouts).toEqual(builtin.layouts);
		assertExitFails(exit, new BadRequest({ message: "Cannot modify built-in saved views" }));
		assertExitFails(
			entitySchemaExit,
			new BadRequest({ message: "Cannot modify built-in saved views" }),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("preserves omitted layouts when updating a non-built-in view", () => {
	let stored: ListedSavedView | undefined;
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(baseView),
			updateBySlug: (_userId, _slug, data) =>
				Effect.sync(() => {
					const updated = {
						...baseView,
						...data,
						pluginSlug: data.pluginSlug ?? null,
						sortOrder: data.sortOrder ?? baseView.sortOrder,
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

		assertExitFails(createExit, new BadRequest({ message: "Entity schema not found" }));
		assertExitFails(updateExit, new BadRequest({ message: "Entity schema not found" }));
	}).pipe(Effect.provide(layer));
});

it.effect("updates and reorders while preserving each layout set", () => {
	const views = [
		{ ...baseView, slug: "view-a", sortOrder: 0 },
		{ ...baseView, slug: "view-b", sortOrder: 1 },
	];
	const updates: Array<{ layouts: SavedViewLayouts; slug: string; sortOrder?: number }> = [];
	const layer = makeServiceLayer(
		makeRepository({
			listByUser: () => Effect.succeed(views),
			findBySlug: (_userId, slug) =>
				Effect.succeed(views.find((view) => view.slug === slug) ?? null),
			updateBySlug: (_userId, slug, data) =>
				Effect.sync(() => {
					updates.push({
						slug,
						layouts: data.layouts,
						...(data.sortOrder === undefined ? {} : { sortOrder: data.sortOrder }),
					});
					return {
						...baseView,
						...data,
						slug,
						pluginSlug: data.pluginSlug ?? null,
						sortOrder: data.sortOrder ?? baseView.sortOrder,
					};
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		expect(yield* service.reorder(user, { viewSlugs: ["view-b", "view-a"] })).toEqual({
			viewSlugs: ["view-b", "view-a"],
		});
		expect(updates).toEqual([
			{ layouts, slug: "view-b", sortOrder: 0 },
			{ layouts, slug: "view-a", sortOrder: 1 },
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("reorders only saved views in the requested scope", () => {
	const views = [
		{ ...baseView, slug: "global-a", sortOrder: 0 },
		{ ...baseView, slug: "global-b", sortOrder: 1 },
		{
			...baseView,
			sortOrder: 0,
			slug: "plugin-a-view",
			pluginSlug: PluginSlug.make("plugin-a"),
		},
	];
	const updates: Array<{ slug: string; sortOrder?: number }> = [];
	const layer = makeServiceLayer(
		makeRepository({
			listByUser: () => Effect.succeed(views),
			findBySlug: (_userId, slug) =>
				Effect.succeed(views.find((view) => view.slug === slug) ?? null),
			updateBySlug: (_userId, slug, data) =>
				Effect.sync(() => {
					updates.push({
						slug,
						...(data.sortOrder === undefined ? {} : { sortOrder: data.sortOrder }),
					});
					return {
						...baseView,
						...data,
						slug,
						pluginSlug: data.pluginSlug ?? null,
						sortOrder: data.sortOrder ?? baseView.sortOrder,
					};
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		expect(yield* service.reorder(user, { viewSlugs: ["global-b", "global-a"] })).toEqual({
			viewSlugs: ["global-b", "global-a"],
		});
		expect(updates).toEqual([
			{ slug: "global-b", sortOrder: 0 },
			{ slug: "global-a", sortOrder: 1 },
		]);
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
					builtinEntitySchemaSlug = view.entitySchemaSlug;
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
