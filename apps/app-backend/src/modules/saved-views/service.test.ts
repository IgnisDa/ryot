import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot/contract/errors";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type {
	CreateSavedViewBody,
	ListedSavedView,
} from "@ryot/contract/modules/saved-views/schemas";
import { SavedViewId, UserId } from "@ryot/contract/schema/brands";
import { ascending, column, document, eq, field, literal, rows, table } from "@ryot/ryotql";
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
const sampleQueryDocument = document({
	savedView: rows(book, {
		fields: [field("id", column(book, "id")), field("name", column(book, "name"))],
		orderBy: [ascending(column(book, "name"))],
	}),
}) satisfies RyotQLDocument;

const baseListedSavedView: ListedSavedView = {
	icon: "book",
	sortOrder: 0,
	slug: "my-view",
	name: "My View",
	pluginSlug: null,
	isBuiltin: false,
	isDisabled: false,
	queryDocument: sampleQueryDocument,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	id: SavedViewId.make("sv-id"),
	displayConfiguration: {
		entityIdField: "id",
		table: { columns: [{ label: "Name", field: "name" }] },
		grid: {
			imageField: null,
			eyebrowField: null,
			calloutField: null,
			titleField: "name",
			primarySubtitleField: null,
			secondarySubtitleField: null,
		},
		list: {
			imageField: null,
			eyebrowField: null,
			calloutField: null,
			titleField: "name",
			primarySubtitleField: null,
			secondarySubtitleField: null,
		},
	},
};

const mockRepository = Layer.mock(SavedViewsRepository);

const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ ...overrides });

const makeDefinitionRegistryLayer = (...views: ReadonlyArray<ListedSavedView>) =>
	Layer.succeed(DefinitionRegistry, {
		...makeDefinitionRegistry({
			entitySchemas: [],
			signalSchemas: [],
			relationshipSchemas: [],
			savedViews: views.map((view) => ({
				icon: view.icon,
				name: view.name,
				slug: view.slug,
				sortOrder: view.sortOrder,
				pluginSlug: view.pluginSlug,
				queryDocument: view.queryDocument,
				displayConfiguration: view.displayConfiguration,
			})),
		}),
	});

const makeServiceLayer = (
	repository = makeRepository(),
	definitionRegistry = makeDefinitionRegistryLayer(),
) =>
	SavedViewsService.layer.pipe(
		Layer.provide(Layer.mergeAll(dbRunnerLayer, transactionLayer, definitionRegistry, repository)),
	);

const createBody = {
	icon: "book",
	name: "My View",
	queryDocument: sampleQueryDocument,
	displayConfiguration: baseListedSavedView.displayConfiguration,
};

it.effect("trims and slugifies saved view names before creating", () => {
	let createdSlug = "";

	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(null),
			create: (_userId, input) =>
				Effect.sync(() => {
					createdSlug = input.slug;
					return { ...baseListedSavedView, name: input.name, slug: input.slug };
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const view = yield* service.create(user, { ...createBody, name: "  My View  " });

		expect(createdSlug).toBe("my-view");
		expect(view.name).toBe("My View");
		expect(view.slug).toBe("my-view");
	}).pipe(Effect.provide(layer));
});

it.effect("reports a duplicate when a concurrent create wins the unique insert", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(null),
			create: () => Effect.succeed(null),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(service.create(user, createBody));

		assertExitFails(
			exit,
			new BadRequest({ message: "A saved view with this name already exists" }),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when getting a view the user does not own", () => {
	const layer = makeServiceLayer(makeRepository({ findBySlug: () => Effect.succeed(null) }));

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(service.get(user, "non-existent"));

		assertExitFails(exit, new NotFound({ message: "Saved view not found" }));
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request when deleting a built-in view", () => {
	const builtinView = { ...baseListedSavedView, slug: "builtin-view", isBuiltin: true };
	const layer = makeServiceLayer(
		makeRepository({ findBySlug: () => Effect.succeed(builtinView) }),
		makeDefinitionRegistryLayer(builtinView),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(service.delete(user, "builtin-view"));

		assertExitFails(exit, new BadRequest({ message: "Cannot modify built-in saved views" }));
	}).pipe(Effect.provide(layer));
});

it.effect("rejects built-in definition changes while still allowing disable toggles", () => {
	const builtinView = { ...baseListedSavedView, name: "Books", slug: "books", isBuiltin: true };
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(builtinView),
			updateBuiltinStateBySlug: (_userId, _viewSlug, isDisabled, sortOrder) =>
				Effect.succeed({ ...builtinView, isDisabled, sortOrder }),
		}),
		makeDefinitionRegistryLayer(builtinView),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const view = yield* service.update(user, "books", {
			...createBody,
			name: "Books",
			isDisabled: true,
		});

		expect(view.isDisabled).toBe(true);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects updating a built-in view name", () => {
	const builtinView = { ...baseListedSavedView, name: "Books", slug: "books", isBuiltin: true };
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(builtinView),
		}),
		makeDefinitionRegistryLayer(builtinView),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(
			service.update(user, "books", {
				...createBody,
				isDisabled: false,
				name: "Renamed Books",
			}),
		);

		assertExitFails(exit, new BadRequest({ message: "Cannot modify built-in saved views" }));
	}).pipe(Effect.provide(layer));
});

it.effect("rejects updating a built-in view's queryDocument", () => {
	const builtinView = { ...baseListedSavedView, slug: "builtin-view", isBuiltin: true };
	const layer = makeServiceLayer(
		makeRepository({ findBySlug: () => Effect.succeed(builtinView) }),
		makeDefinitionRegistryLayer(builtinView),
	);

	const changedDocument: CreateSavedViewBody["queryDocument"] = {
		...sampleQueryDocument,
		queries: {
			...sampleQueryDocument.queries,
			savedView: {
				...sampleQueryDocument.queries.savedView,
				output: {
					...sampleQueryDocument.queries.savedView.output,
					pagination: { page: 5, limit: 20 },
				},
			},
		},
	};

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(
			service.update(user, "builtin-view", {
				...createBody,
				isDisabled: false,
				queryDocument: changedDocument,
			}),
		);

		assertExitFails(exit, new BadRequest({ message: "Cannot modify built-in saved views" }));
	}).pipe(Effect.provide(layer));
});

it.effect("clones a saved view with (Copy) suffix", () => {
	let findCalls = 0;
	let clonedName = "";

	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => {
				findCalls += 1;
				return Effect.succeed(
					findCalls === 1 ? { ...baseListedSavedView, name: "Reading", pluginSlug: null } : null,
				);
			},
			create: (_userId, input) =>
				Effect.sync(() => {
					clonedName = input.name;
					return {
						...baseListedSavedView,
						name: input.name,
						slug: input.slug,
						pluginSlug: input.pluginSlug ?? null,
					};
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const view = yield* service.clone(user, "reading");

		expect(clonedName).toBe("Reading (Copy)");
		expect(view.name).toBe("Reading (Copy)");
		expect(view.pluginSlug).toBeNull();
	}).pipe(Effect.provide(layer));
});

it.effect("reorders requested slugs and appends the remaining", () => {
	const currentViews = [
		{ ...baseListedSavedView, slug: "view-a", sortOrder: 0 },
		{ ...baseListedSavedView, slug: "view-b", sortOrder: 1 },
		{ ...baseListedSavedView, slug: "view-c", sortOrder: 2 },
	];
	const updatedViews: Array<{ slug: string; sortOrder: number | undefined }> = [];

	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: (_userId, slug) =>
				Effect.succeed(currentViews.find((view) => view.slug === slug) ?? null),
			listByUser: () => Effect.succeed(currentViews),
			updateBySlug: (_userId, slug, data) =>
				Effect.sync(() => {
					updatedViews.push({ slug, sortOrder: data.sortOrder });
					const current = currentViews.find((view) => view.slug === slug);
					return current ? { ...current, sortOrder: data.sortOrder ?? current.sortOrder } : null;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const reordered = yield* service.reorder(user, { viewSlugs: ["view-c", "view-a"] });

		expect(reordered).toEqual({ viewSlugs: ["view-c", "view-a", "view-b"] });
		expect(updatedViews).toEqual([
			{ slug: "view-c", sortOrder: 0 },
			{ slug: "view-a", sortOrder: 1 },
			{ slug: "view-b", sortOrder: 2 },
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects reorder requests containing unknown slugs", () => {
	const layer = makeServiceLayer(
		makeRepository({
			listByUser: () => Effect.succeed([{ ...baseListedSavedView, slug: "view-a" }]),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(service.reorder(user, { viewSlugs: ["view-a", "view-b"] }));

		assertExitFails(
			exit,
			new BadRequest({ message: "Saved view slugs contain unknown saved views" }),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("creates a valid saved view definition", () => {
	let createdInput: { queryDocument: unknown } | undefined;

	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(null),
			create: (_userId, input) =>
				Effect.sync(() => {
					createdInput = input;
					return baseListedSavedView;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const view = yield* service.create(user, createBody);

		expect(view.queryDocument).toEqual(sampleQueryDocument);
		expect(createdInput?.queryDocument).toEqual(sampleQueryDocument);
	}).pipe(Effect.provide(layer));
});

const expectInvalidCreate = (
	name: string,
	queryDocument: CreateSavedViewBody["queryDocument"],
	expectedMessage: string,
	displayConfiguration: CreateSavedViewBody["displayConfiguration"] = createBody.displayConfiguration,
) =>
	it.effect(name, () => {
		const layer = makeServiceLayer(makeRepository({ findBySlug: () => Effect.succeed(null) }));

		return Effect.gen(function* () {
			const service = yield* SavedViewsService;
			const exit = yield* Effect.exit(
				service.create(user, { ...createBody, queryDocument, displayConfiguration }),
			);

			assertExitFails(exit, new BadRequest({ message: expectedMessage }));
		}).pipe(Effect.provide(layer));
	});

expectInvalidCreate(
	"rejects saved views with multiple named queries",
	{
		...sampleQueryDocument,
		queries: { ...sampleQueryDocument.queries, second: sampleQueryDocument.queries.savedView },
	},
	"A saved view must contain exactly one named query",
	createBody.displayConfiguration,
);

expectInvalidCreate(
	"rejects saved views without rows output",
	{
		...sampleQueryDocument,
		queries: {
			savedView: {
				...sampleQueryDocument.queries.savedView,
				output: {
					type: "aggregate",
					measures: [{ key: "count", aggregation: { function: "count" } }],
				},
			},
		},
	} as CreateSavedViewBody["queryDocument"],
	"Saved view query must have rows output",
	createBody.displayConfiguration,
);

expectInvalidCreate(
	"rejects saved views with wildcard selections",
	{
		...sampleQueryDocument,
		queries: {
			savedView: {
				...sampleQueryDocument.queries.savedView,
				output: {
					...sampleQueryDocument.queries.savedView.output,
					fields: [{ tableAlias: "book", type: "wildcard" }],
				},
			},
		},
	} as CreateSavedViewBody["queryDocument"],
	"Saved view query must use explicit field selections",
	createBody.displayConfiguration,
);

expectInvalidCreate(
	"rejects saved views with includes",
	{
		...sampleQueryDocument,
		queries: {
			savedView: {
				...sampleQueryDocument.queries.savedView,
				output: {
					...sampleQueryDocument.queries.savedView.output,
					include: [
						{
							limit: 1,
							from: book,
							fields: [],
							key: "children",
							orderBy: [ascending(column(book, "id"))],
						},
					],
				},
			},
		},
	} as CreateSavedViewBody["queryDocument"],
	"Saved view query must not include nested results",
	createBody.displayConfiguration,
);

expectInvalidCreate(
	"rejects saved views whose definition starts on another page",
	{
		...sampleQueryDocument,
		queries: {
			savedView: {
				...sampleQueryDocument.queries.savedView,
				output: {
					...sampleQueryDocument.queries.savedView.output,
					pagination: { page: 2, limit: 20 },
				},
			},
		},
	} as CreateSavedViewBody["queryDocument"],
	"Saved view query pagination page must be 1",
	createBody.displayConfiguration,
);

expectInvalidCreate(
	"rejects saved views with a display field outside the root projection",
	sampleQueryDocument,
	"Saved view display field 'missing' is not in the root projection",
	{ ...createBody.displayConfiguration, entityIdField: "missing" },
);

expectInvalidCreate(
	"rejects saved views with a non-text entity ID field",
	{
		...sampleQueryDocument,
		queries: {
			savedView: {
				...sampleQueryDocument.queries.savedView,
				output: {
					...sampleQueryDocument.queries.savedView.output,
					fields: [
						...sampleQueryDocument.queries.savedView.output.fields,
						field("count", literal(1)),
					],
				},
			},
		},
	} as CreateSavedViewBody["queryDocument"],
	"Saved view entityIdField must resolve to text",
	{ ...createBody.displayConfiguration, entityIdField: "count" },
);

it.effect("rejects creating a saved view with a semantically invalid RyotQL document", () => {
	const layer = makeServiceLayer(makeRepository({ findBySlug: () => Effect.succeed(null) }));
	const unknown = table("entity", "unknownAlias");
	const invalidQueryDocument: CreateSavedViewBody["queryDocument"] = document({
		savedView: rows(book, {
			where: eq(column(unknown, "name"), literal("x")),
			fields: [field("id", column(book, "id")), field("name", column(book, "name"))],
		}),
	});

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(
			service.create(user, { ...createBody, queryDocument: invalidQueryDocument }),
		);

		assertExitFails(
			exit,
			new BadRequest({ message: "Query 'savedView': Unknown table alias 'unknownAlias'" }),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("updates a saved view's queryDocument", () => {
	let updatedQueryDocument: unknown;

	const updatedDocument: CreateSavedViewBody["queryDocument"] = {
		...sampleQueryDocument,
		queries: {
			...sampleQueryDocument.queries,
			savedView: {
				...sampleQueryDocument.queries.savedView,
				output: { ...sampleQueryDocument.queries.savedView.output, orderBy: [] },
			},
		},
	};

	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(baseListedSavedView),
			updateBySlug: (_userId, _slug, data) =>
				Effect.sync(() => {
					updatedQueryDocument = data.queryDocument;
					return { ...baseListedSavedView, queryDocument: data.queryDocument };
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const view = yield* service.update(user, "my-view", {
			...createBody,
			isDisabled: false,
			queryDocument: updatedDocument,
		});

		expect(view.queryDocument).toEqual(updatedDocument);
		expect(updatedQueryDocument).toEqual(updatedDocument);
	}).pipe(Effect.provide(layer));
});
