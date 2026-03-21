import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, Conflict, DbError, NotFound } from "@ryot/contract/errors";
import type {
	CreateSavedViewBody,
	ListedSavedView,
} from "@ryot/contract/modules/saved-views/schemas";
import { SavedViewId, TrackerId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import { type MockOverrides, dbRunnerLayer, transactionLayer } from "#lib/test-utils/effect";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { QueryEngineService } from "#modules/query-engine/service";

import { SavedViewsRepository } from "./repository";
import { SavedViewsService } from "./service";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const sampleQueryDocument = {
	source: { type: "entities", alias: "book", schemas: ["book"], where: null },
	output: {
		fields: [],
		type: "rows",
		pagination: { page: 1, limit: 20 },
		orderBy: [
			{
				order: "asc",
				expr: { type: "ref", sourceAlias: "book", field: { type: "system", name: "name" } },
			},
		],
	},
} as const;

const baseListedSavedView: ListedSavedView = {
	icon: "book",
	sortOrder: 0,
	slug: "my-view",
	name: "My View",
	trackerId: null,
	isBuiltin: false,
	isDisabled: false,
	accentColor: "#FF5733",
	id: SavedViewId.make("sv-id"),
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	queryDocument: sampleQueryDocument,
	displayConfiguration: {
		entityIdProperty: { type: "literal", value: "id" },
		table: { columns: [{ label: "Name", expression: { type: "literal", value: "name" } }] },
		grid: {
			imageProperty: null,
			eyebrowProperty: null,
			calloutProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
			titleProperty: { type: "literal", value: "name" },
		},
		list: {
			imageProperty: null,
			eyebrowProperty: null,
			calloutProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
			titleProperty: { type: "literal", value: "name" },
		},
	},
};

const mockRepository = Layer.mock(SavedViewsRepository);

const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ _tag: "SavedViewsRepository", ...overrides });

const mockQueryEngine = Layer.mock(QueryEngineService);

const makeQueryEngine = (overrides: MockOverrides<typeof mockQueryEngine> = {}) =>
	mockQueryEngine({
		_tag: "QueryEngineService",
		validate: () => Effect.void.pipe(Effect.as(undefined)),
		...overrides,
	});

const mockEntitySchemasRepository = Layer.mock(EntitySchemasRepository);

const makeEntitySchemasRepository = (
	overrides: MockOverrides<typeof mockEntitySchemasRepository> = {},
) =>
	mockEntitySchemasRepository({
		_tag: "EntitySchemasRepository",
		listVisibleBySlugs: () => Effect.succeed([]),
		...overrides,
	});

const makeServiceLayer = (
	repository = makeRepository(),
	queryEngine = makeQueryEngine(),
	entitySchemasRepository = makeEntitySchemasRepository(),
) =>
	SavedViewsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				entitySchemasRepository,
				queryEngine,
				repository,
			),
		),
	);

const createBody = {
	icon: "book",
	name: "My View",
	accentColor: "#FF5733",
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

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "A saved view with this name already exists" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when getting a view the user does not own", () => {
	const layer = makeServiceLayer(makeRepository({ findBySlug: () => Effect.succeed(null) }));

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(service.get(user, "non-existent"));

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Saved view not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request when deleting a built-in view", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed({ ...baseListedSavedView, isBuiltin: true }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(service.delete(user, "builtin-view"));

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Cannot modify built-in saved views" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects built-in definition changes while still allowing disable toggles", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed({ ...baseListedSavedView, name: "Books", isBuiltin: true }),
			updateDisabledBySlug: (_userId, _slug, isDisabled) =>
				Effect.succeed({ ...baseListedSavedView, isBuiltin: true, name: "Books", isDisabled }),
		}),
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

it.effect("allows built-in disable toggles with independently decoded nested literals", () => {
	const queryDocument = {
		...sampleQueryDocument,
		source: {
			...sampleQueryDocument.source,
			where: {
				operator: "eq",
				type: "comparison",
				right: { type: "literal", value: { nested: [1, { value: "same" }] } },
				left: { type: "ref", sourceAlias: "book", field: { type: "system", name: "name" } },
			},
		},
	} satisfies CreateSavedViewBody["queryDocument"];
	const displayConfiguration = {
		...baseListedSavedView.displayConfiguration,
		entityIdProperty: { type: "literal", value: { nested: [1, { value: "same" }] } },
	} satisfies CreateSavedViewBody["displayConfiguration"];
	const currentView = {
		...baseListedSavedView,
		queryDocument,
		isBuiltin: true,
		displayConfiguration,
	};
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(currentView),
			updateDisabledBySlug: (_userId, _slug, isDisabled) =>
				Effect.succeed({ ...currentView, isDisabled }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const view = yield* service.update(user, "builtin-view", {
			...createBody,
			isDisabled: true,
			queryDocument: structuredClone(queryDocument),
			displayConfiguration: structuredClone(displayConfiguration),
		});

		expect(view.isDisabled).toBe(true);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects updating a built-in view name", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed({ ...baseListedSavedView, name: "Books", isBuiltin: true }),
		}),
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

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Cannot modify built-in saved views" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects updating a built-in view's queryDocument", () => {
	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed({ ...baseListedSavedView, isBuiltin: true }),
		}),
	);

	const changedDocument: CreateSavedViewBody["queryDocument"] = {
		...sampleQueryDocument,
		output: { ...sampleQueryDocument.output, pagination: { page: 5, limit: 20 } },
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

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Cannot modify built-in saved views" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("clones a saved view with (Copy) suffix", () => {
	let clonedName = "";
	let findCalls = 0;
	let validated = false;

	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => {
				findCalls += 1;
				return Effect.succeed(
					findCalls === 1
						? {
								...baseListedSavedView,
								name: "Reading",
								trackerId: null,
							}
						: null,
				);
			},
			create: (_userId, input) =>
				Effect.sync(() => {
					clonedName = input.name;
					return {
						...baseListedSavedView,
						name: input.name,
						slug: input.slug,
						trackerId: input.trackerId ?? null,
					};
				}),
		}),
		makeQueryEngine({
			validate: () =>
				Effect.sync(() => {
					validated = true;
				}).pipe(Effect.as(undefined)),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const view = yield* service.clone(user, "reading");

		expect(clonedName).toBe("Reading (Copy)");
		expect(view.name).toBe("Reading (Copy)");
		expect(view.trackerId).toBeNull();
		expect(validated).toBe(true);
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
			countBySlugs: () => Effect.succeed(2),
			findBySlug: (_userId, slug) =>
				Effect.succeed(currentViews.find((view) => view.slug === slug) ?? null),
			listInOrder: () => Effect.succeed(currentViews),
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
	const layer = makeServiceLayer(makeRepository({ countBySlugs: () => Effect.succeed(1) }));

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(service.reorder(user, { viewSlugs: ["view-a", "view-b"] }));

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Saved view slugs contain unknown saved views" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("creates a saved view after validating the query document", () => {
	let validatedDocument: unknown;
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
		makeQueryEngine({
			validate: (_user, doc) =>
				Effect.sync(() => {
					validatedDocument = doc;
				}).pipe(Effect.as(undefined)),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const view = yield* service.create(user, createBody);

		expect(view.queryDocument).toEqual(sampleQueryDocument);
		expect(validatedDocument).toEqual(sampleQueryDocument);
		expect(createdInput?.queryDocument).toEqual(sampleQueryDocument);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects creating a saved view with a semantically invalid v2 query document", () => {
	const layer = makeServiceLayer(
		makeRepository({ findBySlug: () => Effect.succeed(null) }),
		makeQueryEngine({
			validate: () =>
				Effect.fail(new BadRequest({ message: "Unknown source alias 'unknownAlias'" })),
		}),
	);
	const invalidQueryDocument: CreateSavedViewBody["queryDocument"] = {
		...sampleQueryDocument,
		source: {
			...sampleQueryDocument.source,
			where: {
				operator: "eq",
				type: "comparison",
				right: { type: "literal", value: "x" },
				left: {
					type: "ref",
					sourceAlias: "unknownAlias",
					field: { type: "system", name: "name" },
				},
			},
		},
	};

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(
			service.create(user, { ...createBody, queryDocument: invalidQueryDocument }),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Unknown source alias 'unknownAlias'" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect(
	"rejects creating a saved view whose display config references an entity schema not in the query document",
	() => {
		const layer = makeServiceLayer(makeRepository({ findBySlug: () => Effect.succeed(null) }));

		const badDisplayConfig: CreateSavedViewBody["displayConfiguration"] = {
			...createBody.displayConfiguration,
			entityIdProperty: {
				type: "reference",
				reference: { type: "entity", slug: "wrong-schema", path: ["id"] },
			},
		};

		return Effect.gen(function* () {
			const service = yield* SavedViewsService;
			const exit = yield* Effect.exit(
				service.create(user, { ...createBody, displayConfiguration: badDisplayConfig }),
			);

			expect(exit).toEqual(
				Exit.fail(
					new BadRequest({
						message:
							"Display configuration references entity schema 'wrong-schema' which is not in the query document source",
					}),
				),
			);
		}).pipe(Effect.provide(layer));
	},
);

it.effect(
	"rejects updating a saved view whose display config references an entity schema not in the query document",
	() => {
		const layer = makeServiceLayer(
			makeRepository({ findBySlug: () => Effect.succeed(baseListedSavedView) }),
		);

		const badDisplayConfig: CreateSavedViewBody["displayConfiguration"] = {
			...createBody.displayConfiguration,
			grid: {
				...createBody.displayConfiguration.grid,
				titleProperty: {
					type: "reference",
					reference: { type: "entity", slug: "nonexistent", path: ["name"] },
				},
			},
		};

		return Effect.gen(function* () {
			const service = yield* SavedViewsService;
			const exit = yield* Effect.exit(
				service.update(user, "my-view", {
					...createBody,
					isDisabled: false,
					displayConfiguration: badDisplayConfig,
				}),
			);

			expect(exit).toEqual(
				Exit.fail(
					new BadRequest({
						message:
							"Display configuration references entity schema 'nonexistent' which is not in the query document source",
					}),
				),
			);
		}).pipe(Effect.provide(layer));
	},
);

it.effect("creates a default saved view for an entity schema", () => {
	let createdInput: { slug: string; name: string; isBuiltin: boolean } | undefined;
	let validatedDocument: unknown;

	const layer = makeServiceLayer(
		makeRepository({
			findBySlug: () => Effect.succeed(null),
			create: (_userId, input) =>
				Effect.sync(() => {
					createdInput = input;
					return { ...baseListedSavedView, slug: input.slug, name: input.name, isBuiltin: true };
				}),
		}),
		makeQueryEngine({
			validate: (_user, doc) =>
				Effect.sync(() => {
					validatedDocument = doc;
				}).pipe(Effect.as(undefined)),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const view = yield* service.createDefaultForSchema({
			icon: "book",
			userId: user.id,
			accentColor: "#FF5733",
			entitySchemaName: "Custom Schema",
			entitySchemaSlug: "custom-schema",
			trackerId: TrackerId.make("tracker-id"),
		});

		expect(view.isBuiltin).toBe(true);
		expect(createdInput?.isBuiltin).toBe(true);
		expect(createdInput?.slug).toBe("all-custom-schema");
		expect(createdInput?.name).toBe("All Custom Schemas");
		expect(validatedDocument).toMatchObject({ source: { schemas: ["custom-schema"] } });
	}).pipe(Effect.provide(layer));
});

it.effect("rejects creating a default saved view when one already exists for the schema", () => {
	const layer = makeServiceLayer(
		makeRepository({ findBySlug: () => Effect.succeed(baseListedSavedView) }),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(
			service.createDefaultForSchema({
				icon: "book",
				userId: user.id,
				accentColor: "#FF5733",
				entitySchemaName: "Book",
				entitySchemaSlug: "book",
				trackerId: TrackerId.make("tracker-id"),
			}),
		);

		expect(exit).toEqual(
			Exit.fail(new Conflict({ message: "Entity schema default saved view already exists" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("maps default saved view validation failures to database errors", () => {
	const layer = makeServiceLayer(
		makeRepository({ findBySlug: () => Effect.succeed(null) }),
		makeQueryEngine({
			validate: () => Effect.fail(new DbError({ message: "schema lookup failed" })),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SavedViewsService;
		const exit = yield* Effect.exit(
			service.createDefaultForSchema({
				icon: "book",
				userId: user.id,
				accentColor: "#FF5733",
				entitySchemaName: "Custom Schema",
				entitySchemaSlug: "custom-schema",
				trackerId: TrackerId.make("tracker-id"),
			}),
		);

		expect(exit).toEqual(Exit.fail(new DbError({ message: "schema lookup failed" })));
	}).pipe(Effect.provide(layer));
});

it.effect("updates a saved view's queryDocument", () => {
	let updatedQueryDocument: unknown;

	const updatedDocument: CreateSavedViewBody["queryDocument"] = {
		...sampleQueryDocument,
		output: { ...sampleQueryDocument.output, pagination: { page: 2, limit: 20 } },
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
