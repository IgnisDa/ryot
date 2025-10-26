import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { BadRequest, NotFound } from "#lib/errors";
import {
	EntityId,
	EntitySchemaId,
	RelationshipId,
	RelationshipSchemaId,
	UserId,
} from "#lib/schema/brands";
import { dbRunnerLayer, makeMock } from "#lib/test-support/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";

import { RelationshipsRepository } from "./repository";
import { RelationshipsService } from "./service";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
} satisfies CurrentUserValue;

const sourceEntityId = EntityId.make("source-entity-id");
const targetEntityId = EntityId.make("target-entity-id");
const sourceEntitySchemaId = EntitySchemaId.make("source-schema-id");
const targetEntitySchemaId = EntitySchemaId.make("target-schema-id");
const relationshipSchemaId = RelationshipSchemaId.make("rel-schema-id");

const sourceEntityScope = {
	isBuiltin: false,
	entityUserId: user.id,
	entityId: sourceEntityId,
	entitySchemaSlug: "book",
	entitySchemaId: sourceEntitySchemaId,
};

const targetEntityScope = {
	isBuiltin: false,
	entityUserId: user.id,
	entityId: targetEntityId,
	entitySchemaSlug: "book",
	entitySchemaId: targetEntitySchemaId,
};

const relationshipSchema = {
	isBuiltin: false,
	id: relationshipSchemaId,
	name: "Test Relationship",
	slug: "test-relationship",
	sourceEntitySchemaId: null,
	targetEntitySchemaId: null,
	propertiesSchema: { fields: {} },
};

const savedRelationship = {
	properties: {},
	sourceEntityId,
	targetEntityId,
	wasInserted: true,
	relationshipSchemaId,
	id: RelationshipId.make("rel-id"),
	createdAt: "2026-06-22T00:00:00.000Z",
};

const makeRelationshipsRepository = (overrides: Partial<RelationshipsRepository> = {}) =>
	makeMock<RelationshipsRepository>(
		{
			_tag: "RelationshipsRepository" as const,
			upsertMembership: () => Effect.die("unused"),
			deleteMembership: () => Effect.die("unused"),
			insertRelationship: () => Effect.die("unused"),
			upsertRelationship: () => Effect.die("unused"),
			upsertEntityRelationship: () => Effect.die("unused"),
			findRelationshipProperties: () => Effect.die("unused"),
			deleteUserRelationshipsForEntity: () => Effect.die("unused"),
			moveUserRelationshipsBetweenEntities: () => Effect.die("unused"),
		},
		overrides,
	);

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
			listMatchCandidatesBySchema: () => Effect.die("unused"),
			findEntitySchemaScriptBySlug: () => Effect.die("unused"),
			findGlobalEntityByExternalId: () => Effect.die("unused"),
			findEntityByExternalIdForUser: () => Effect.die("unused"),
		},
		overrides,
	);

const makeRelationshipSchemasRepository = (
	overrides: Partial<RelationshipSchemasRepository> = {},
) =>
	makeMock<RelationshipSchemasRepository>(
		{
			findById: () => Effect.die("unused"),
			listByUser: () => Effect.die("unused"),
			_tag: "RelationshipSchemasRepository" as const,
			findBuiltinBySlug: () => Effect.die("unused"),
			findBySlugForUser: () => Effect.die("unused"),
			findGlobalBySchemaIds: () => Effect.die("unused"),
			getEntitySchemaScopeById: () => Effect.die("unused"),
			createRelationshipSchema: () => Effect.die("unused"),
		},
		overrides,
	);

const makeServiceLayer = (
	relationships: RelationshipsRepository,
	entities: EntitiesRepository,
	relationshipSchemas: RelationshipSchemasRepository,
) =>
	RelationshipsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				Layer.succeed(RelationshipsRepository, relationships),
				Layer.succeed(EntitiesRepository, entities),
				Layer.succeed(RelationshipSchemasRepository, relationshipSchemas),
			),
		),
	);

const makeDefaultLayer = (
	overrides: {
		entities?: Partial<EntitiesRepository>;
		relationships?: Partial<RelationshipsRepository>;
		relationshipSchemas?: Partial<RelationshipSchemasRepository>;
	} = {},
) =>
	makeServiceLayer(
		makeRelationshipsRepository(overrides.relationships),
		makeEntitiesRepository(overrides.entities),
		makeRelationshipSchemasRepository(overrides.relationshipSchemas),
	);

const defaultPayload = { sourceEntityId, targetEntityId, relationshipSchemaId };

it.effect("returns not found when relationship schema is inaccessible", () => {
	const layer = makeDefaultLayer({
		relationshipSchemas: { findById: () => Effect.succeed(null) },
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const exit = yield* Effect.exit(service.create(user, defaultPayload));
		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Relationship schema not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when source entity is inaccessible", () => {
	const layer = makeDefaultLayer({
		relationshipSchemas: { findById: () => Effect.succeed(relationshipSchema) },
		entities: {
			getEntityScopeForUser: ({ entityId }) =>
				entityId === sourceEntityId ? Effect.succeed(null) : Effect.succeed(targetEntityScope),
		},
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const exit = yield* Effect.exit(service.create(user, defaultPayload));
		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when target entity is inaccessible", () => {
	const layer = makeDefaultLayer({
		relationshipSchemas: { findById: () => Effect.succeed(relationshipSchema) },
		entities: {
			getEntityScopeForUser: ({ entityId }) =>
				entityId === targetEntityId ? Effect.succeed(null) : Effect.succeed(sourceEntityScope),
		},
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const exit = yield* Effect.exit(service.create(user, defaultPayload));
		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request when source entity schema does not match constraint", () => {
	const constrainedSchema = {
		...relationshipSchema,
		sourceEntitySchemaId: EntitySchemaId.make("other-schema-id"),
	};
	const layer = makeDefaultLayer({
		relationshipSchemas: { findById: () => Effect.succeed(constrainedSchema) },
		entities: { getEntityScopeForUser: () => Effect.succeed(sourceEntityScope) },
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const exit = yield* Effect.exit(service.create(user, defaultPayload));
		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Relationship source entity schema does not match" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request when target entity schema does not match constraint", () => {
	const constrainedSchema = {
		...relationshipSchema,
		targetEntitySchemaId: EntitySchemaId.make("other-schema-id"),
	};
	const layer = makeDefaultLayer({
		relationshipSchemas: { findById: () => Effect.succeed(constrainedSchema) },
		entities: { getEntityScopeForUser: () => Effect.succeed(sourceEntityScope) },
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const exit = yield* Effect.exit(service.create(user, defaultPayload));
		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Relationship target entity schema does not match" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request when properties violate the relationship schema", () => {
	const schemaWithEnum = {
		...relationshipSchema,
		propertiesSchema: {
			fields: {
				status: {
					label: "Status",
					type: "enum" as const,
					description: "Status",
					options: ["active", "inactive"],
				},
			},
		},
	};
	const layer = makeDefaultLayer({
		relationshipSchemas: { findById: () => Effect.succeed(schemaWithEnum) },
		entities: { getEntityScopeForUser: () => Effect.succeed(sourceEntityScope) },
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const exit = yield* Effect.exit(
			service.create(user, { ...defaultPayload, properties: { status: "deleted" } }),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(exit.cause._tag).toBe("Fail");
		}
	}).pipe(Effect.provide(layer));
});

it.effect("creates relationship and returns saved relationship", () => {
	const layer = makeDefaultLayer({
		relationshipSchemas: { findById: () => Effect.succeed(relationshipSchema) },
		entities: { getEntityScopeForUser: () => Effect.succeed(sourceEntityScope) },
		relationships: { upsertRelationship: () => Effect.succeed(savedRelationship) },
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const result = yield* service.create(user, defaultPayload);
		expect(result).toEqual(savedRelationship);
	}).pipe(Effect.provide(layer));
});
