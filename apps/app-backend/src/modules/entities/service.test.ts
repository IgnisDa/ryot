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
import { QueryEngineService } from "#modules/query-engine/service";
import { SandboxRepository } from "#modules/sandbox/repository";

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

const makeServiceLayer = (repository = makeEntitiesRepository()) =>
	EntitiesService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeAppConfigLayer(),
				fakeWorkflowEngineLayer,
				makeQueryEngine(),
				repository,
				makeSandboxRepository(),
			),
		),
	);

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
