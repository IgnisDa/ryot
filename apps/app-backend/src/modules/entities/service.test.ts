import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { NotFound } from "@ryot/contract/errors";
import type { FieldValue } from "@ryot/contract/modules/query-engine/language";
import { EntityId, EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import { type MockOverrides, dbRunnerLayer } from "#lib/test-support/effect";
import { QueryEngineService } from "#modules/query-engine/service";

import { EntitiesRepository } from "./repository";
import { EntitiesService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

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
			Layer.mergeAll(dbRunnerLayer, options.queryEngine ?? makeQueryEngine(), repository),
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
	entitySchemaId: field("text", "schema-1"),
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
					entityUserId: user.id,
					entitySchemaSlug: "person",
					propertiesSchema: { fields: {} },
					entityId: EntityId.make("entity-1"),
					entitySchemaId: EntitySchemaId.make("schema-1"),
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
						createdAt: now,
						updatedAt: now,
						properties: {},
						name: "Created",
						populatedAt: null,
						externalId: "ext-1",
						id: EntityId.make("created-entity"),
						entitySchemaId: EntitySchemaId.make("schema-id"),
						sandboxScriptId: SandboxScriptId.make("script-id"),
					};
				}),
			getEntitySchemaScopeForUser: () =>
				Effect.succeed({
					slug: "book",
					userId: user.id,
					id: EntitySchemaId.make("schema-id"),
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
					entitySchemaId: EntitySchemaId.make("schema-id"),
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
			entitySchemaId: EntitySchemaId.make("schema-id"),
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
				entitySchemaId: EntitySchemaId.make("schema-id"),
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
