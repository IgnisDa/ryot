import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest } from "@ryot/contract/errors";
import type { ListedSavedView, SavedViewLayouts } from "@ryot/contract/modules/saved-views/schemas";
import { SavedViewId, UserId } from "@ryot/contract/schema/brands";
import { ascending, column, document, field, rows, table } from "@ryot/ryotql";
import { Effect, Layer } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import { type MockOverrides, dbRunnerLayer, transactionLayer } from "#lib/test-utils/effect";
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
	calloutField: null,
	entityIdField: "id",
	overlineField: null,
	primaryMetadataField: null,
	secondaryMetadataField: null,
} as const;
const layouts = {
	grid: cardLayout,
	list: cardLayout,
	table: {
		queryDocument,
		imageField: null,
		entityIdField: "id",
		columns: [{ label: "Name", field: "name" }],
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
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	id: SavedViewId.make("sv-id"),
};
const createBody = { layouts, icon: "book", name: "My View" };
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
				({ icon, layouts: viewLayouts, name, pluginSlug, slug, sortOrder }) => ({
					icon,
					name,
					slug,
					sortOrder,
					pluginSlug,
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
		Layer.provide(Layer.mergeAll(dbRunnerLayer, transactionLayer, definitionRegistry, repository)),
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
			...createBody,
			isDisabled: true,
		});
		const exit = yield* Effect.exit(
			service.update(user, builtin.slug, {
				...createBody,
				isDisabled: false,
				layouts: { ...layouts, grid: { ...layouts.grid, titleField: "id" } },
			}),
		);

		expect(updated.isDisabled).toBe(true);
		assertExitFails(exit, new BadRequest({ message: "Cannot modify built-in saved views" }));
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

it.effect("persists builtin layouts unchanged", () => {
	let builtinLayouts: SavedViewLayouts | undefined;
	const layer = makeServiceLayer(
		makeRepository({
			ensureBuiltinViews: (_userId, views) =>
				Effect.sync(() => {
					builtinLayouts = views[0]?.layouts;
				}),
		}),
		makeDefinitionRegistryLayer({ ...baseView, isBuiltin: true }),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		yield* service.ensureBuiltinViews(user.id);
		expect(builtinLayouts).toEqual(layouts);
	}).pipe(Effect.provide(layer));
});
