import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { NotFound } from "@ryot/contract/errors";
import type { FieldValue } from "@ryot/contract/modules/query-engine/language";
import {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import { type MockOverrides, dbRunnerLayer, transactionLayer } from "#lib/test-utils/effect";
import { QueryEngineService } from "#modules/query-engine/service";

import { LifecycleDispatch, LifecycleDispatchNoop } from "./lifecycle-dispatch";
import { EntitiesRepository } from "./repository";
import { EntitiesService } from "./service";

const now = "2026-06-14T00:00:00.000Z";
const nowDate = new Date(now);

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({ _tag: "EntitiesRepository", ...overrides });

const mockQueryEngine = Layer.mock(QueryEngineService);

const makeQueryEngine = (overrides: MockOverrides<typeof mockQueryEngine> = {}) =>
	mockQueryEngine({
		_tag: "QueryEngineService",
		validate: () => Effect.void.pipe(Effect.as(undefined)),
		...overrides,
	});

const makeServiceLayer = (
	repository = makeEntitiesRepository(),
	options: { queryEngine?: Layer.Layer<QueryEngineService> } = {},
) =>
	Layer.mergeAll(
		EntitiesService.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					dbRunnerLayer,
					LifecycleDispatchNoop,
					options.queryEngine ?? makeQueryEngine(),
					repository,
				),
			),
		),
		transactionLayer,
	);

const field = (kind: FieldValue["kind"], value: unknown): FieldValue => ({ kind, value });

const makeEntityRow = (overrides: Record<string, FieldValue> = {}): Record<string, FieldValue> => ({
	id: field("text", "entity-1"),
	name: field("text", "Cooper"),
	properties: field("json", {}),
	createdAt: field("date", now),
	updatedAt: field("date", now),
	populatedAt: field("null", null),
	externalId: field("text", "ext-1"),
	entitySchemaSlug: field("text", "schema-1"),
	providerId: field("text", "provider-1"),
	translationStatus: field("text", "pending"),
	...overrides,
});

const rowsResponse = (item: Record<string, FieldValue>) => ({
	type: "rows" as const,
	data: { pageInfo: { page: 1, limit: 1, total: 1, hasMore: false }, items: [item] },
});

const setupGetById = (row: Record<string, FieldValue>) => {
	const layer = makeServiceLayer(
		makeEntitiesRepository({
			getEntityScopeForUser: () =>
				Effect.succeed({
					isBuiltin: false,
					entityName: "Cooper",
					entityUserId: user.id,
					entitySchemaSlug: "person",
					propertiesSchema: { fields: {} },
					entityId: EntityId.make("entity-1"),
				}),
		}),
		{ queryEngine: makeQueryEngine({ execute: () => Effect.succeed(rowsResponse(row)) }) },
	);
	return { layer };
};

it.effect("returns existing entity when provenance already exists", () => {
	let insertCalled = false;

	const layer = makeServiceLayer(
		makeEntitiesRepository({
			insertEntity: () =>
				Effect.sync(() => {
					insertCalled = true;
					return {
						wasInserted: true,
						entity: {
							createdAt: now,
							updatedAt: now,
							properties: {},
							name: "Created",
							populatedAt: null,
							externalId: "ext-1",
							id: EntityId.make("created-entity"),
							entitySchemaSlug: EntitySchemaSlug.make("schema-id"),
							providerId: SandboxProviderId.make("provider-id"),
						},
					};
				}),
			getEntitySchemaScopeForUser: () =>
				Effect.succeed({
					slug: "book",
					userId: user.id,
					id: EntitySchemaSlug.make("schema-id"),
					isBuiltin: false,
					propertiesSchema: {
						fields: { title: { type: "string", label: "Title", description: "Title" } },
					},
				}),
			findEntityByExternalIdForUser: () =>
				Effect.succeed({
					createdAt: now,
					updatedAt: now,
					name: "Existing",
					populatedAt: null,
					externalId: "ext-1",
					properties: { title: "Existing" },
					id: EntityId.make("existing-entity"),
					entitySchemaSlug: EntitySchemaSlug.make("schema-id"),
					providerId: SandboxProviderId.make("provider-id"),
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const entity = yield* service.create({
			scope: "user",
			name: "Existing",
			userId: user.id,
			externalId: "ext-1",
			properties: { title: "Existing" },
			entitySchemaSlug: EntitySchemaSlug.make("schema-id"),
			providerId: SandboxProviderId.make("provider-id"),
		});

		expect(entity.id).toBe("existing-entity");
		expect(insertCalled).toBe(false);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when entity schema is not visible", () => {
	const layer = makeServiceLayer(
		makeEntitiesRepository({ getEntitySchemaScopeForUser: () => Effect.succeed(null) }),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const exit = yield* Effect.exit(
			service.create({
				scope: "user",
				properties: {},
				userId: user.id,
				name: "Hidden Schema Entity",
				entitySchemaSlug: EntitySchemaSlug.make("schema-id"),
			}),
		);

		assertExitFails(exit, new NotFound({ message: "Entity schema not found" }));
	}).pipe(Effect.provide(layer));
});

it.effect("does not reuse the bootstrap service with its no-op lifecycle dispatcher", () => {
	let dispatched = false;
	const repository = makeEntitiesRepository({
		getEntitySchemaScopeForUser: () =>
			Effect.succeed({
				slug: "workout",
				userId: user.id,
				isBuiltin: true,
				propertiesSchema: { fields: {} },
				id: EntitySchemaSlug.make("workout"),
			}),
		insertEntity: () =>
			Effect.succeed({
				wasInserted: true,
				entity: {
					createdAt: now,
					updatedAt: now,
					properties: {},
					name: "Workout",
					externalId: null,
					populatedAt: null,
					providerId: null,
					id: EntityId.make("workout-1"),
					entitySchemaSlug: EntitySchemaSlug.make("workout"),
				},
			}),
	});
	const dependencies = Layer.mergeAll(dbRunnerLayer, makeQueryEngine(), repository);
	const bootstrap = Layer.fresh(EntitiesService.Default).pipe(
		Layer.provide(Layer.mergeAll(dependencies, LifecycleDispatchNoop)),
	);
	const runtime = EntitiesService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dependencies,
				Layer.succeed(LifecycleDispatch, {
					dispatch: () => Effect.sync(() => (dispatched = true)),
				}),
			),
		),
	);
	const layer = bootstrap.pipe(Layer.flatMap(() => runtime));

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		yield* service.create({
			scope: "user",
			properties: {},
			name: "Workout",
			userId: user.id,
			origin: { kind: "api" },
			entitySchemaSlug: EntitySchemaSlug.make("workout"),
		});

		expect(dispatched).toBe(true);
	}).pipe(Effect.provide(layer));
});

it.effect("returns the translationStatus sourced from the query-engine computed field", () => {
	const { layer } = setupGetById(makeEntityRow({ translationStatus: field("text", "ready") }));

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const entity = yield* service.getById(user, EntityId.make("entity-1"));

		expect(entity.id).toBe("entity-1");
		expect(entity.translationStatus).toBe("ready");
	}).pipe(Effect.provide(layer));
});

const titlePropertiesSchema = {
	fields: { title: { type: "string" as const, label: "Title", description: "Title" } },
};

const globalEntity = {
	createdAt: now,
	updatedAt: now,
	populatedAt: null,
	name: "Cooper",
	externalId: "ext-1",
	properties: { title: "Cooper" },
	id: EntityId.make("entity-1"),
	entitySchemaSlug: EntitySchemaSlug.make("person"),
	providerId: SandboxProviderId.make("provider-1"),
};

const upsertInput = (updateExisting: boolean) => ({
	updateExisting,
	name: "Cooper",
	populatedAt: null,
	externalId: "ext-1",
	properties: { title: "Cooper" },
	entitySchemaSlug: EntitySchemaSlug.make("person"),
	providerId: SandboxProviderId.make("provider-1"),
});

const globalSchemaScope = { slug: "person", propertiesSchema: titlePropertiesSchema };

it.effect("upsert creates a new global entity when none exists", () => {
	let updateCalled = false;
	const layer = makeServiceLayer(
		makeEntitiesRepository({
			updateEntity: () =>
				Effect.sync(() => {
					updateCalled = true;
					return globalEntity;
				}),
			findEntitySchemaById: () => Effect.succeed(globalSchemaScope),
			insertEntity: () =>
				Effect.succeed({
					wasInserted: true,
					entity: { ...globalEntity, id: EntityId.make("created-entity") },
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const result = yield* service.upsert(upsertInput(false));

		expect(result.entity.id).toBe("created-entity");
		expect(result.outcome).toEqual({
			before: null,
			operation: "create",
			after: {
				name: "Cooper",
				entitySchemaSlug: "person",
				properties: { title: "Cooper" },
				id: EntityId.make("created-entity"),
			},
		});
		expect(updateCalled).toBe(false);
	}).pipe(Effect.provide(layer));
});

it.effect("upsertGlobalEntities remains unbounded without maximumTotal", () => {
	const inserts: unknown[] = [];
	let countCalled = false;
	let lockCalled = false;
	const layer = makeServiceLayer(
		makeEntitiesRepository({
			countGlobalEntitiesByProvenanceScope: () =>
				Effect.sync(() => {
					countCalled = true;
					return 0;
				}),
			findEntitySchemaById: () => Effect.succeed(globalSchemaScope),
			lockGlobalEntityProvenanceScope: () =>
				Effect.sync(() => {
					lockCalled = true;
				}),
			insertEntity: (input) =>
				Effect.sync(() => {
					inserts.push(input);
					return { entity: globalEntity, wasInserted: false };
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const result = yield* service.upsertGlobalEntities(
			[
				{
					name: "Replacement",
					externalId: "ext-1",
					populatedAt: null,
					properties: { title: "Replacement" },
					entitySchemaSlug: EntitySchemaSlug.make("person"),
				},
			],
			SandboxProviderId.make("provider-1"),
		);

		expect(result).toEqual([
			{ status: "upserted", entityId: EntityId.make("entity-1"), wasInserted: false },
		]);
		expect(countCalled).toBe(false);
		expect(lockCalled).toBe(false);
		expect(inserts).toEqual([
			{
				scope: "global",
				populatedAt: null,
				name: "Replacement",
				externalId: "ext-1",
				properties: { title: "Replacement" },
				providerId: SandboxProviderId.make("provider-1"),
				entitySchemaSlug: EntitySchemaSlug.make("person"),
			},
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("counts existing entities outside the submitted prefix before admitting new rows", () => {
	let insertCalled = false;
	const layer = makeServiceLayer(
		makeEntitiesRepository({
			findEntitySchemaById: () => Effect.succeed(globalSchemaScope),
			lockGlobalEntityProvenanceScope: () => Effect.void,
			countGlobalEntitiesByProvenanceScope: () => Effect.succeed(2),
			findGlobalEntityByExternalId: () => Effect.succeed(null),
			insertEntity: () =>
				Effect.sync(() => {
					insertCalled = true;
					return { entity: globalEntity, wasInserted: true };
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const result = yield* service.upsertGlobalEntities(
			[
				{
					name: "New",
					populatedAt: null,
					externalId: "new-1",
					properties: { title: "New" },
					entitySchemaSlug: EntitySchemaSlug.make("person"),
				},
			],
			SandboxProviderId.make("provider-1"),
			{ maximumTotal: 2 },
		);

		expect(result).toEqual([{ status: "skipped" }]);
		expect(insertCalled).toBe(false);
	}).pipe(Effect.provide(layer));
});

it.effect("locks affected provenance scopes in deterministic order", () => {
	const locked: EntitySchemaSlug[] = [];
	const layer = makeServiceLayer(
		makeEntitiesRepository({
			findEntitySchemaById: () => Effect.succeed(globalSchemaScope),
			countGlobalEntitiesByProvenanceScope: () => Effect.succeed(0),
			findGlobalEntityByExternalId: () => Effect.succeed(null),
			lockGlobalEntityProvenanceScope: ({ entitySchemaSlug }) =>
				Effect.sync(() => {
					locked.push(entitySchemaSlug);
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const result = yield* service.upsertGlobalEntities(
			["zeta", "alpha", "zeta"].map((entitySchemaSlug, index) => ({
				populatedAt: null,
				name: `Entity ${index}`,
				externalId: `external-${index}`,
				properties: { title: `Entity ${index}` },
				entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
			})),
			SandboxProviderId.make("provider-1"),
			{ maximumTotal: 0 },
		);

		expect(result).toEqual([{ status: "skipped" }, { status: "skipped" }, { status: "skipped" }]);
		expect(locked).toEqual([EntitySchemaSlug.make("alpha"), EntitySchemaSlug.make("zeta")]);
	}).pipe(Effect.provide(layer));
});

it.effect("preserves submitted existing entities when maximumTotal is zero", () => {
	const layer = makeServiceLayer(
		makeEntitiesRepository({
			findEntitySchemaById: () => Effect.succeed(globalSchemaScope),
			lockGlobalEntityProvenanceScope: () => Effect.void,
			countGlobalEntitiesByProvenanceScope: () => Effect.succeed(1),
			findGlobalEntityByExternalId: ({ externalId }) =>
				Effect.succeed(externalId === "ext-1" ? globalEntity : null),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const result = yield* service.upsertGlobalEntities(
			[
				{
					name: "Existing",
					populatedAt: null,
					externalId: "ext-1",
					properties: { title: "Existing" },
					entitySchemaSlug: EntitySchemaSlug.make("person"),
				},
				{
					name: "New",
					populatedAt: null,
					externalId: "new-1",
					properties: { title: "New" },
					entitySchemaSlug: EntitySchemaSlug.make("person"),
				},
			],
			SandboxProviderId.make("provider-1"),
			{ maximumTotal: 0 },
		);

		expect(result).toEqual([
			{ status: "upserted", entityId: EntityId.make("entity-1"), wasInserted: false },
			{ status: "skipped" },
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("returns aligned existing, inserted, and skipped outcomes at the scope maximum", () => {
	const stored = new Map([["ext-1", globalEntity]]);
	const layer = makeServiceLayer(
		makeEntitiesRepository({
			findEntitySchemaById: () => Effect.succeed(globalSchemaScope),
			lockGlobalEntityProvenanceScope: () => Effect.void,
			countGlobalEntitiesByProvenanceScope: () => Effect.succeed(1),
			findGlobalEntityByExternalId: ({ externalId }) =>
				Effect.succeed(stored.get(externalId) ?? null),
			insertEntity: (input) => {
				const entity = {
					...globalEntity,
					name: input.name,
					externalId: input.externalId ?? "",
					id: EntityId.make(`entity-${stored.size + 1}`),
				};
				stored.set(input.externalId ?? "", entity);
				return Effect.succeed({ entity, wasInserted: true });
			},
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const result = yield* service.upsertGlobalEntities(
			["ext-1", "new-1", "new-2"].map((externalId) => ({
				externalId,
				name: externalId,
				populatedAt: null,
				properties: { title: externalId },
				entitySchemaSlug: EntitySchemaSlug.make("person"),
			})),
			SandboxProviderId.make("provider-1"),
			{ maximumTotal: 2 },
		);

		expect(result).toEqual([
			{ status: "upserted", entityId: EntityId.make("entity-1"), wasInserted: false },
			{ status: "upserted", entityId: EntityId.make("entity-2"), wasInserted: true },
			{ status: "skipped" },
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("upsert captures a material update", () => {
	const existing = {
		...globalEntity,
		name: "Existing",
		populatedAt: now,
		properties: { title: "Existing" },
		id: EntityId.make("existing-entity"),
	};
	const layer = makeServiceLayer(
		makeEntitiesRepository({
			findEntitySchemaById: () => Effect.succeed(globalSchemaScope),
			insertEntity: () => Effect.succeed({ entity: existing, wasInserted: false }),
			updateEntity: (input) =>
				Effect.succeed({
					...existing,
					name: input.name,
					id: input.entityId,
					properties: input.properties,
					populatedAt: input.populatedAt?.toISOString() ?? null,
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const result = yield* service.upsert(upsertInput(true));

		expect(result.entity.name).toBe("Cooper");
		expect(result.outcome.operation).toBe("update");
		expect(result.outcome.before).toMatchObject({
			name: "Existing",
			properties: { title: "Existing" },
		});
		expect(result.outcome.after).toMatchObject({
			name: "Cooper",
			properties: { title: "Cooper" },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("upsert classifies a timestamp-only skeleton population as noop", () => {
	let updateCalled = false;
	const skeleton = { ...globalEntity, populatedAt: null, id: EntityId.make("skeleton-entity") };
	const layer = makeServiceLayer(
		makeEntitiesRepository({
			findEntitySchemaById: () => Effect.succeed(globalSchemaScope),
			insertEntity: () => Effect.succeed({ entity: skeleton, wasInserted: false }),
			updateEntity: (input) =>
				Effect.sync(() => {
					updateCalled = true;
					return { ...skeleton, ...input, populatedAt: now, id: input.entityId };
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const result = yield* service.upsert({ ...upsertInput(false), populatedAt: nowDate });

		expect(result.entity.id).toBe("skeleton-entity");
		expect(result.outcome.operation).toBe("noop");
		expect(result.outcome.before).toEqual(result.outcome.after);
		expect(updateCalled).toBe(true);
	}).pipe(Effect.provide(layer));
});

it.effect("upsert preserves an existing populated entity when updateExisting is not set", () => {
	let updateCalled = false;
	const existing = {
		...globalEntity,
		populatedAt: now,
		name: "Existing",
		id: EntityId.make("existing-entity"),
	};
	const layer = makeServiceLayer(
		makeEntitiesRepository({
			findEntitySchemaById: () => Effect.succeed(globalSchemaScope),
			insertEntity: () => Effect.succeed({ entity: existing, wasInserted: false }),
			updateEntity: () =>
				Effect.sync(() => {
					updateCalled = true;
					return existing;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const result = yield* service.upsert(upsertInput(false));

		expect(result.entity.id).toBe("existing-entity");
		expect(result.entity.name).toBe("Existing");
		expect(result.outcome.operation).toBe("noop");
		expect(result.outcome.before).toEqual(result.outcome.after);
		expect(updateCalled).toBe(false);
	}).pipe(Effect.provide(layer));
});
