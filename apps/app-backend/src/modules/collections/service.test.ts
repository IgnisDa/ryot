import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { BadRequest, NotFound } from "#lib/errors";
import {
	dbRunnerLayer,
	makeMock,
	makeWorkflowEngine,
	transactionLayer,
} from "#lib/test-support/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { CollectionsRepository } from "./repository";
import { CollectionsService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

const user: CurrentUserValue = { id: "user-id", name: "Test User", email: "user@example.com" };

const memberOfSchema = {
	isBuiltin: true,
	slug: "member-of",
	name: "Member Of",
	id: "member-of-schema-id",
	sourceEntitySchemaId: null,
	targetEntitySchemaId: null,
	propertiesSchema: { fields: {}, unknownKeys: "passthrough" as const },
};

const inLibrarySchema = {
	isBuiltin: true,
	slug: "in-library",
	name: "In Library",
	id: "in-library-schema-id",
	sourceEntitySchemaId: null,
	targetEntitySchemaId: null,
	propertiesSchema: { fields: {} },
};

const collectionEntitySchema = {
	id: "collection-schema-id",
	entitySchemaId: "collection-schema-id",
	propertiesSchema: {
		fields: {
			description: { label: "Description", type: "string", description: "Description" },
			membershipPropertiesSchema: {
				type: "object",
				properties: {},
				unknownKeys: "passthrough",
				label: "Membership Properties Schema",
				description: "Membership Properties Schema",
			},
		},
	},
};

const addEventSchema = {
	id: "add-event-schema-id",
	name: "Add Entity to Collection",
	slug: "add-entity-to-collection",
};

const removeEventSchema = {
	id: "remove-event-schema-id",
	name: "Remove Entity from Collection",
	slug: "remove-entity-from-collection",
};

const makeCollectionsRepository = (overrides: Partial<CollectionsRepository> = {}) =>
	makeMock<CollectionsRepository>(
		{
			_tag: "CollectionsRepository" as const,
			getCollectionById: () => Effect.die("unused"),
			getEntityForMembership: () => Effect.die("unused"),
			getUserLibraryEntityId: () => Effect.die("unused"),
			findLibraryEntityForUser: () => Effect.die("unused"),
			findCollectionByNameForUser: () => Effect.die("unused"),
			getBuiltinCollectionSchema: () => Effect.succeed(collectionEntitySchema),
			findBuiltinEventSchemaBySlug: (_entitySchemaId: string, slug: string) =>
				slug === "add-entity-to-collection"
					? Effect.succeed(addEventSchema)
					: Effect.succeed(removeEventSchema),
		},
		overrides,
	);

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}) =>
	makeMock<EntitiesRepository>(
		{ _tag: "EntitiesRepository" as const, createEntity: () => Effect.die("unused") },
		overrides,
	);

const makeRelationshipsRepository = (overrides: Partial<RelationshipsRepository> = {}) =>
	makeMock<RelationshipsRepository>(
		{
			insertRelationship: () => Effect.void,
			_tag: "RelationshipsRepository" as const,
			deleteMembership: () => Effect.die("unused"),
			upsertMembership: () => Effect.die("unused"),
			upsertRelationship: () => Effect.die("unused"),
			findRelationshipProperties: () => Effect.die("unused"),
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
			findBuiltinBySlug: (slug: string) =>
				slug === "member-of" ? Effect.succeed(memberOfSchema) : Effect.succeed(inLibrarySchema),
		},
		overrides,
	);

const makeServiceLayer = (
	options: {
		workflowEngine?: WorkflowEngine["Type"];
		entitiesRepository?: EntitiesRepository;
		collectionsRepository?: CollectionsRepository;
		relationshipsRepository?: RelationshipsRepository;
		relationshipSchemasRepository?: RelationshipSchemasRepository;
	} = {},
) =>
	CollectionsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				Layer.succeed(WorkflowEngine, options.workflowEngine ?? makeWorkflowEngine()),
				Layer.succeed(
					CollectionsRepository,
					options.collectionsRepository ?? makeCollectionsRepository(),
				),
				Layer.succeed(EntitiesRepository, options.entitiesRepository ?? makeEntitiesRepository()),
				Layer.succeed(
					RelationshipsRepository,
					options.relationshipsRepository ?? makeRelationshipsRepository(),
				),
				Layer.succeed(
					RelationshipSchemasRepository,
					options.relationshipSchemasRepository ?? makeRelationshipSchemasRepository(),
				),
			),
		),
	);

it.effect("rejects creating a collection with an empty name", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(service.create(user, { name: "  " }));

		expect(exit).toEqual(Exit.fail(new BadRequest({ message: "Collection name is required" })));
	}).pipe(Effect.provide(layer));
});

it.effect("rejects creating a collection with invalid membershipPropertiesSchema", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(
			service.create(user, {
				name: "My Collection",
				membershipPropertiesSchema: { fields: { x: { type: "invalid_type" } } },
			}),
		);

		const errorMessage = exit.pipe(
			Exit.match({
				onSuccess: () => Option.none(),
				onFailure: (cause) =>
					Cause.failureOption(cause).pipe(
						Option.map((e) => (e as { message?: string }).message ?? ""),
					),
			}),
		);

		expect(Option.isSome(errorMessage)).toBe(true);
		expect(Option.getOrNull(errorMessage)).toContain(
			"membershipPropertiesSchema must be a valid AppSchema",
		);
	}).pipe(Effect.provide(layer));
});

it.effect("creates a collection with valid inputs", () => {
	let created = false;

	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			createEntity: () => {
				created = true;
				return Effect.succeed({
					image: null,
					createdAt: now,
					updatedAt: now,
					externalId: null,
					name: "Favorites",
					populatedAt: null,
					id: "collection-id",
					sandboxScriptId: null,
					entitySchemaId: "collection-schema-id",
					properties: { description: "My favorites" },
				});
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const result = yield* service.create(user, { name: "Favorites", description: "My favorites" });

		expect(created).toBe(true);
		expect(result.name).toBe("Favorites");
		expect(result.id).toBe("collection-id");
	}).pipe(Effect.provide(layer));
});

it.effect("rejects adding a collection to itself", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(
			service.addToCollection(user, { entityId: "same-id", collectionId: "same-id" }),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Cannot add a collection to itself" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when collection does not exist for user", () => {
	const layer = makeServiceLayer({
		collectionsRepository: makeCollectionsRepository({
			getCollectionById: () => Effect.succeed(null),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(
			service.addToCollection(user, { entityId: "entity-id", collectionId: "missing-id" }),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Collection not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when entity does not exist", () => {
	const layer = makeServiceLayer({
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () => Effect.succeed(null),
			getCollectionById: () =>
				Effect.succeed({
					image: null,
					name: "Coll",
					id: "coll-id",
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					sandboxScriptId: null,
					entitySchemaId: "collection-schema-id",
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(
			service.addToCollection(user, { entityId: "missing-id", collectionId: "coll-id" }),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("creates membership event only on first add, not on upsert", () => {
	let queuedEventCount = 0;

	const membership = {
		id: "rel-id",
		createdAt: now,
		properties: {},
		wasInserted: true,
		targetEntityId: "coll-id",
		sourceEntityId: "entity-id",
		relationshipSchemaId: "member-of-schema-id",
	};
	const workflowEngine = makeWorkflowEngine({
		execute: (_workflow, options) => {
			queuedEventCount++;
			return Effect.succeed(options.executionId);
		},
	});

	const layer = makeServiceLayer({
		workflowEngine,
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () =>
				Effect.succeed({ id: "entity-id", userId: user.id, entitySchemaSlug: "book" }),
			getCollectionById: () =>
				Effect.succeed({
					image: null,
					name: "Coll",
					id: "coll-id",
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					sandboxScriptId: null,
					entitySchemaId: "collection-schema-id",
				}),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			upsertMembership: () => Effect.succeed(membership),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		yield* service.addToCollection(user, { entityId: "entity-id", collectionId: "coll-id" });

		expect(queuedEventCount).toBe(1);
	}).pipe(Effect.provide(layer));
});

it.effect("does not create membership event on upsert update", () => {
	let queuedEventCount = 0;

	const membership = {
		id: "rel-id",
		createdAt: now,
		properties: {},
		wasInserted: false,
		targetEntityId: "coll-id",
		sourceEntityId: "entity-id",
		relationshipSchemaId: "member-of-schema-id",
	};
	const workflowEngine = makeWorkflowEngine({
		execute: (_workflow, options) => {
			queuedEventCount++;
			return Effect.succeed(options.executionId);
		},
	});

	const layer = makeServiceLayer({
		workflowEngine,
		relationshipsRepository: makeRelationshipsRepository({
			upsertMembership: () => Effect.succeed(membership),
		}),
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () =>
				Effect.succeed({ id: "entity-id", userId: user.id, entitySchemaSlug: "book" }),
			getCollectionById: () =>
				Effect.succeed({
					image: null,
					name: "Coll",
					id: "coll-id",
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					sandboxScriptId: null,
					entitySchemaId: "collection-schema-id",
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		yield* service.addToCollection(user, { entityId: "entity-id", collectionId: "coll-id" });

		expect(queuedEventCount).toBe(0);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when removing entity not in collection", () => {
	const layer = makeServiceLayer({
		relationshipsRepository: makeRelationshipsRepository({
			deleteMembership: () => Effect.succeed(null),
		}),
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () =>
				Effect.succeed({ id: "entity-id", userId: user.id, entitySchemaSlug: "book" }),
			getCollectionById: () =>
				Effect.succeed({
					image: null,
					name: "Coll",
					id: "coll-id",
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					sandboxScriptId: null,
					entitySchemaId: "collection-schema-id",
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(
			service.removeFromCollection(user, { entityId: "entity-id", collectionId: "coll-id" }),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity is not in collection" })));
	}).pipe(Effect.provide(layer));
});

it.effect("creates remove event on successful membership deletion", () => {
	let queuedEventCount = 0;

	const deletedMembership = {
		id: "rel-id",
		createdAt: now,
		properties: {},
		targetEntityId: "coll-id",
		sourceEntityId: "entity-id",
		relationshipSchemaId: "member-of-schema-id",
	};
	const workflowEngine = makeWorkflowEngine({
		execute: (_workflow, options) => {
			queuedEventCount++;
			return Effect.succeed(options.executionId);
		},
	});

	const layer = makeServiceLayer({
		workflowEngine,
		relationshipsRepository: makeRelationshipsRepository({
			deleteMembership: () => Effect.succeed(deletedMembership),
		}),
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () =>
				Effect.succeed({ id: "entity-id", userId: user.id, entitySchemaSlug: "book" }),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					id: "coll-id",
					image: null,
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					sandboxScriptId: null,
					entitySchemaId: "collection-schema-id",
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const result = yield* service.removeFromCollection(user, {
			entityId: "entity-id",
			collectionId: "coll-id",
		});

		expect(queuedEventCount).toBe(1);
		expect(result.memberOf.id).toBe("rel-id");
	}).pipe(Effect.provide(layer));
});

it.effect("merges ownership sources when marking an entity owned in the library", () => {
	let upserted: { properties: Record<string, unknown> } | undefined;

	const layer = makeServiceLayer({
		collectionsRepository: makeCollectionsRepository({
			getUserLibraryEntityId: () => Effect.succeed("library-entity-id"),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			findRelationshipProperties: () =>
				Effect.succeed({ owned: true, ownershipSources: ["plex_yank"] }),
			upsertRelationship: (input: { properties: Record<string, unknown> }) => {
				upserted = input;
				return Effect.succeed({
					id: "rel-id",
					createdAt: now,
					wasInserted: true,
					sourceEntityId: "entity-id",
					properties: input.properties,
					targetEntityId: "library-entity-id",
					relationshipSchemaId: "in-library-schema-id",
				});
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		yield* service.markEntityOwnedInLibrary({
			syncedAt: now,
			provider: "komga",
			userId: "user-id",
			entityId: "entity-id",
		});

		expect(upserted?.properties).toEqual({
			owned: true,
			ownershipSyncedAt: now,
			ownershipSources: ["plex_yank", "komga"],
		});
	}).pipe(Effect.provide(layer));
});
