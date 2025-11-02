import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { NotFound } from "#lib/errors";
import {
	EntityId,
	EntitySchemaId,
	RemoteImageUrl,
	SandboxScriptId,
	UserId,
} from "#lib/schema/brands";
import {
	type MockOverrides,
	dbRunnerLayer,
	makeAppConfigLayer,
	makeWorkflowEngine,
	transactionLayer,
} from "#lib/test-support/effect";
import type { FieldValue } from "#modules/query-engine/language";
import { QueryEngineService } from "#modules/query-engine/service";
import { SandboxRepository } from "#modules/sandbox/repository";

import { EntityPopulationTrigger, EntityPopulationTriggerNoop } from "./population-trigger";
import { EntitiesRepository } from "./repository";
import { EntitiesService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
} satisfies CurrentUserValue;

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({ _tag: "EntitiesRepository", ...overrides });

const fakeWorkflowEngineLayer = Layer.succeed(WorkflowEngine, makeWorkflowEngine());

const mockSandboxRepository = Layer.mock(SandboxRepository);

const makeSandboxRepository = (overrides: MockOverrides<typeof mockSandboxRepository> = {}) =>
	mockSandboxRepository({ _tag: "SandboxRepository", ...overrides });

const mockQueryEngine = Layer.mock(QueryEngineService);

const makeQueryEngine = (overrides: MockOverrides<typeof mockQueryEngine> = {}) =>
	mockQueryEngine({
		_tag: "QueryEngineService",
		validate: () => Effect.void.pipe(Effect.as(undefined)),
		...overrides,
	});

const makeServiceLayer = (
	repository = makeEntitiesRepository(),
	options: {
		queryEngine?: Layer.Layer<QueryEngineService>;
		populationTrigger?: Layer.Layer<EntityPopulationTrigger>;
	} = {},
) =>
	EntitiesService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeAppConfigLayer(),
				fakeWorkflowEngineLayer,
				options.queryEngine ?? makeQueryEngine(),
				repository,
				makeSandboxRepository(),
				options.populationTrigger ?? EntityPopulationTriggerNoop,
			),
		),
	);

const field = (kind: FieldValue["kind"], value: unknown): FieldValue => ({ kind, value });

const makeEntityRow = (overrides: Record<string, FieldValue> = {}): Record<string, FieldValue> => ({
	image: field("null", null),
	id: field("text", "entity-1"),
	name: field("text", "Cooper"),
	properties: field("json", {}),
	createdAt: field("date", now),
	updatedAt: field("date", now),
	externalId: field("text", "ext-1"),
	populatedAt: field("null", null),
	entitySchemaId: field("text", "schema-1"),
	sandboxScriptId: field("text", "script-1"),
	...overrides,
});

const rowsResponse = (item: Record<string, FieldValue>) => ({
	type: "rows" as const,
	data: { pageInfo: { page: 1, limit: 1, total: 1, hasMore: false }, items: [item] },
});

const setupGetById = (row: Record<string, FieldValue>) => {
	const requested: string[] = [];
	const layer = makeServiceLayer(
		makeEntitiesRepository({
			getEntityScopeForUser: () =>
				Effect.succeed({
					isBuiltin: false,
					entityUserId: user.id,
					entitySchemaSlug: "person",
					entityId: EntityId.make("entity-1"),
					entitySchemaId: EntitySchemaId.make("schema-1"),
				}),
		}),
		{
			queryEngine: makeQueryEngine({ execute: () => Effect.succeed(rowsResponse(row)) }),
			populationTrigger: Layer.succeed(EntityPopulationTrigger, {
				request: (input) =>
					Effect.sync(() => {
						requested.push(input.entityId);
					}),
			}),
		},
	);
	return { layer, requested };
};

it.effect("returns existing entity when provenance already exists", () => {
	let createCalled = false;

	const layer = makeServiceLayer(
		makeEntitiesRepository({
			saveEntity: () =>
				Effect.sync(() => {
					createCalled = true;
					return {
						image: null,
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
					image: null,
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
		const entity = yield* service.create(user, {
			name: "Existing",
			externalId: "ext-1",
			properties: { title: "Existing" },
			entitySchemaId: EntitySchemaId.make("schema-id"),
			sandboxScriptId: SandboxScriptId.make("script-id"),
			image: { type: "remote", url: RemoteImageUrl.make("https://example.com/cover.jpg") },
		});

		expect(entity.id).toBe("existing-entity");
		expect(createCalled).toBe(false);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when entity schema is not visible", () => {
	const layer = makeServiceLayer(
		makeEntitiesRepository({ getEntitySchemaScopeForUser: () => Effect.succeed(null) }),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const exit = yield* Effect.exit(
			service.create(user, {
				properties: {},
				name: "Hidden Schema Entity",
				entitySchemaId: EntitySchemaId.make("schema-id"),
			}),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity schema not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("enqueues population when a surfaced entity is partial", () => {
	const { layer, requested } = setupGetById(makeEntityRow());

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const entity = yield* service.getById(user, EntityId.make("entity-1"));

		expect(entity.id).toBe("entity-1");
		expect(requested).toEqual(["entity-1"]);
	}).pipe(Effect.provide(layer));
});

it.effect("does not enqueue population when the surfaced entity is already populated", () => {
	const { layer, requested } = setupGetById(makeEntityRow({ populatedAt: field("date", now) }));

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		yield* service.getById(user, EntityId.make("entity-1"));

		expect(requested).toEqual([]);
	}).pipe(Effect.provide(layer));
});

it.effect("does not enqueue population for a partial entity without a populating script", () => {
	const { layer, requested } = setupGetById(
		makeEntityRow({ sandboxScriptId: field("null", null) }),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		yield* service.getById(user, EntityId.make("entity-1"));

		expect(requested).toEqual([]);
	}).pipe(Effect.provide(layer));
});
