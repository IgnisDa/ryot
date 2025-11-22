import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { BadRequest, NotFound } from "#lib/errors";
import {
	EntityId,
	EntitySchemaId,
	RelationshipSchemaId,
	RemoteImageUrl,
	SandboxScriptId,
	UserId,
} from "#lib/schema/brands";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeMock,
	makeWorkflowEngine,
	transactionLayer,
} from "#lib/test-support/effect";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SandboxRepository } from "#modules/sandbox/repository";

import { EntitiesRepository } from "./repository";
import { EntitiesService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

const user = {
	id: UserId.make("user-id"),
	name: "Test User",
	email: "user@example.com",
} satisfies CurrentUserValue;

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}) =>
	makeMock<EntitiesRepository>(
		{
			_tag: "EntitiesRepository" as const,
			createEntity: () => Effect.die("unused"),
			getByIdForUser: () => Effect.die("unused"),
			getEntityScopeById: () => Effect.die("unused"),
			findEntitySchemaById: () => Effect.die("unused"),
			getEntityScopeForUser: () => Effect.die("unused"),
			getEntityMergeScopeForUser: () => Effect.die("unused"),
			createOrUpdateGlobalEntity: () => Effect.die("unused"),
			getEntitySchemaScopeForUser: () => Effect.die("unused"),
			findEntitySchemaScriptBySlug: () => Effect.die("unused"),
			findGlobalEntityByExternalId: () => Effect.die("unused"),
			findEntityByExternalIdForUser: () => Effect.die("unused"),
		},
		overrides,
	);

const makeRelationshipsRepository = (overrides: Partial<RelationshipsRepository> = {}) =>
	makeMock<RelationshipsRepository>(
		{
			_tag: "RelationshipsRepository" as const,
			insertRelationship: () => Effect.die("unused"),
			upsertRelationship: () => Effect.die("unused"),
			upsertEntityRelationship: () => Effect.die("unused"),
			findRelationshipProperties: () => Effect.die("unused"),
			deleteUserRelationshipsForEntity: () => Effect.die("unused"),
			moveUserRelationshipsBetweenEntities: () => Effect.die("unused"),
		},
		overrides,
	);

const makeRelationshipSchemasRepository = (
	overrides: Partial<RelationshipSchemasRepository> = {},
) =>
	makeMock<RelationshipSchemasRepository>(
		{
			findById: () => Effect.die("unused"),
			_tag: "RelationshipSchemasRepository" as const,
			findBuiltinBySlug: () => Effect.die("unused"),
		},
		overrides,
	);

const fakeWorkflowEngineLayer = Layer.succeed(WorkflowEngine, makeWorkflowEngine());

const makeSandboxRepository = (overrides: Partial<SandboxRepository> = {}) =>
	makeMock<SandboxRepository>(
		{
			_tag: "SandboxRepository" as const,
			createScript: () => Effect.die("unused"),
			getScriptForUser: () => Effect.die("unused"),
			findScriptBySlugForUser: () => Effect.die("unused"),
		},
		overrides,
	);

const makeServiceLayer = (
	repository: EntitiesRepository,
	relationshipSchemasRepository: RelationshipSchemasRepository = makeRelationshipSchemasRepository(),
	relationshipsRepository: RelationshipsRepository = makeRelationshipsRepository(),
) =>
	EntitiesService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeAppConfigLayer(),
				fakeWorkflowEngineLayer,
				Layer.succeed(EntitiesRepository, repository),
				Layer.succeed(SandboxRepository, makeSandboxRepository()),
				Layer.succeed(RelationshipsRepository, relationshipsRepository),
				Layer.succeed(RelationshipSchemasRepository, relationshipSchemasRepository),
			),
		),
	);

it.effect("returns existing entity when provenance already exists", () => {
	let createCalled = false;

	const layer = makeServiceLayer(
		makeEntitiesRepository({
			createEntity: () =>
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
					id: EntityId.make("existing-entity"),
					entitySchemaId: EntitySchemaId.make("schema-id"),
					sandboxScriptId: SandboxScriptId.make("script-id"),
					properties: { title: "Existing" },
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const entity = yield* service.create(user, {
			name: "Existing",
			externalId: "ext-1",
			entitySchemaId: EntitySchemaId.make("schema-id"),
			sandboxScriptId: SandboxScriptId.make("script-id"),
			properties: { title: "Existing" },
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
				entitySchemaId: EntitySchemaId.make("schema-id"),
				name: "Hidden Schema Entity",
			}),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity schema not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("validates relationship properties before upserting user relationships", () => {
	const layer = makeServiceLayer(
		makeEntitiesRepository({
			getEntityScopeForUser: ({ entityId }) =>
				Effect.succeed({
					entityId,
					isBuiltin: false,
					entityUserId: user.id,
					entitySchemaSlug: "book",
					entitySchemaId: EntitySchemaId.make("schema-id"),
				}),
		}),
		makeRelationshipSchemasRepository({
			findById: () =>
				Effect.succeed({
					isBuiltin: false,
					slug: "linked-to",
					name: "Linked To",
					sourceEntitySchemaId: EntitySchemaId.make("schema-id"),
					targetEntitySchemaId: EntitySchemaId.make("schema-id"),
					id: RelationshipSchemaId.make("relationship-schema-id"),
					propertiesSchema: {
						fields: {
							rating: {
								type: "number",
								label: "Rating",
								description: "Rating",
								validation: { required: true },
							},
						},
					},
				}),
		}),
		makeRelationshipsRepository({
			upsertRelationship: () => Effect.die("should not be called"),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const exit = yield* Effect.exit(
			service.upsertUserRelationship({
				properties: {},
				userId: user.id,
				sourceEntityId: EntityId.make("entity-a"),
				targetEntityId: EntityId.make("entity-b"),
				relationshipSchemaId: RelationshipSchemaId.make("relationship-schema-id"),
			}),
		);

		expect(exit).toEqual(Exit.fail(new BadRequest({ message: "rating: is missing" })));
	}).pipe(Effect.provide(layer));
});
