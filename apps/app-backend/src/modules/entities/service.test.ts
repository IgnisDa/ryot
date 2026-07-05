import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { NotFound } from "@ryot/contract/errors";
import type { FieldValue } from "@ryot/contract/modules/query-engine/language";
import { EntityId, EntitySchemaSlug, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import { type MockOverrides, dbRunnerLayer } from "#lib/test-utils/effect";
import { QueryEngineService } from "#modules/query-engine/service";

import { LifecycleDispatchNoop } from "./lifecycle-dispatch";
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
	EntitiesService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				LifecycleDispatchNoop,
				options.queryEngine ?? makeQueryEngine(),
				repository,
			),
		),
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
	sandboxScriptId: field("text", "script-1"),
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
							sandboxScriptId: SandboxScriptId.make("script-id"),
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
					sandboxScriptId: SandboxScriptId.make("script-id"),
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
			sandboxScriptId: SandboxScriptId.make("script-id"),
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

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity schema not found" })));
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
	sandboxScriptId: SandboxScriptId.make("script-1"),
};

const upsertInput = (updateExisting: boolean) => ({
	updateExisting,
	name: "Cooper",
	populatedAt: null,
	externalId: "ext-1",
	properties: { title: "Cooper" },
	entitySchemaSlug: EntitySchemaSlug.make("person"),
	sandboxScriptId: SandboxScriptId.make("script-1"),
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
