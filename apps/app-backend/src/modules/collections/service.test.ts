import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { CurrentDb, DbRunner, TransactionRunner } from "#lib/db";
import { BadRequest, NotFound } from "#lib/errors";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";

import { CollectionsRepository } from "./repository";
import { CollectionsService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

const user: CurrentUserValue = {
	id: "user-id",
	name: "Test User",
	email: "user@example.com",
};

const dbRunnerLayer = Layer.succeed(DbRunner, <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const transactionLayer = Layer.succeed(
	TransactionRunner,
	<A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const makeWorkflowEngine = (overrides: Partial<WorkflowEngine["Type"]> = {}) =>
	Object.assign(
		{
			poll: () => Effect.die("unused"),
			resume: () => Effect.die("unused"),
			execute: () => Effect.die("unused"),
			register: () => Effect.die("unused"),
			interrupt: () => Effect.die("unused"),
			deferredDone: () => Effect.die("unused"),
			scheduleClock: () => Effect.die("unused"),
			deferredResult: () => Effect.die("unused"),
			activityExecute: () => Effect.die("unused"),
		},
		overrides,
	) as WorkflowEngine["Type"];

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

const defaultCollectionsRepository = () =>
	Object.assign(Object.create(null), {
		_tag: "CollectionsRepository" as const,
		deleteMembership: () => Effect.die("unused"),
		upsertMembership: () => Effect.die("unused"),
		getCollectionById: () => Effect.die("unused"),
		getEntityForMembership: () => Effect.die("unused"),
		getUserLibraryEntityId: () => Effect.die("unused"),
		createCollectionForUser: () => Effect.die("unused"),
		createLibraryEntityForUser: () => Effect.die("unused"),
		getBuiltinCollectionSchema: () => Effect.succeed(collectionEntitySchema),
		findBuiltinEventSchemaBySlug: (_entitySchemaId: string, slug: string) =>
			slug === "add-entity-to-collection"
				? Effect.succeed(addEventSchema)
				: Effect.succeed(removeEventSchema),
	});

const defaultRelationshipSchemasRepository = () =>
	Object.assign(Object.create(null), {
		findById: () => Effect.die("unused"),
		_tag: "RelationshipSchemasRepository" as const,
		findBuiltinBySlug: (slug: string) =>
			slug === "member-of" ? Effect.succeed(memberOfSchema) : Effect.succeed(inLibrarySchema),
	});

const defaultEntitiesRepository = () =>
	Object.assign(Object.create(null), {
		_tag: "EntitiesRepository" as const,
		insertRelationship: () => Effect.void,
		createEntity: () => Effect.die("unused"),
		getByIdForUser: () => Effect.die("unused"),
		getEntityScopeById: () => Effect.die("unused"),
		upsertRelationship: () => Effect.die("unused"),
		getEntityScopeForUser: () => Effect.die("unused"),
		upsertEntityRelationship: () => Effect.die("unused"),
		deleteUserEventsForEntity: () => Effect.die("unused"),
		getEntitySchemaScopeForUser: () => Effect.die("unused"),
		findEntityByExternalIdForUser: () => Effect.die("unused"),
		deleteUserRelationshipsForEntity: () => Effect.die("unused"),
	});

const makeServiceLayer = (
	collectionsRepository: CollectionsRepository = defaultCollectionsRepository(),
	entitiesRepository: EntitiesRepository = defaultEntitiesRepository(),
	relationshipSchemasRepository: RelationshipSchemasRepository = defaultRelationshipSchemasRepository(),
	workflowEngine: WorkflowEngine["Type"] = makeWorkflowEngine(),
) =>
	CollectionsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				Layer.succeed(WorkflowEngine, workflowEngine),
				Layer.succeed(CollectionsRepository, collectionsRepository),
				Layer.succeed(EntitiesRepository, entitiesRepository),
				Layer.succeed(RelationshipSchemasRepository, relationshipSchemasRepository),
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

	const layer = makeServiceLayer(
		Object.assign(Object.create(null), defaultCollectionsRepository(), {
			createCollectionForUser: () => {
				created = true;
				return Effect.succeed({
					createdAt: now,
					updatedAt: now,
					name: "Favorites",
					id: "collection-id",
					entitySchemaId: "collection-schema-id",
					properties: { description: "My favorites" },
				});
			},
		}),
	);

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
	const layer = makeServiceLayer(
		Object.assign(Object.create(null), defaultCollectionsRepository(), {
			getCollectionById: () => Effect.succeed(null),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(
			service.addToCollection(user, { entityId: "entity-id", collectionId: "missing-id" }),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Collection not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when entity does not exist", () => {
	const layer = makeServiceLayer(
		Object.assign(Object.create(null), defaultCollectionsRepository(), {
			getEntityForMembership: () => Effect.succeed(null),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					id: "coll-id",
					createdAt: now,
					updatedAt: now,
					properties: {},
					entitySchemaId: "collection-schema-id",
				}),
		}),
	);

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
		execute: ((_workflow, options) => {
			queuedEventCount++;
			return Effect.succeed(options.executionId);
		}) as WorkflowEngine["Type"]["execute"],
	});

	const layer = makeServiceLayer(
		Object.assign(Object.create(null), defaultCollectionsRepository(), {
			upsertMembership: () => Effect.succeed(membership),
			getEntityForMembership: () =>
				Effect.succeed({ id: "entity-id", userId: user.id, entitySchemaSlug: "book" }),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					id: "coll-id",
					createdAt: now,
					updatedAt: now,
					properties: {},
					entitySchemaId: "collection-schema-id",
				}),
		}),
		defaultEntitiesRepository(),
		defaultRelationshipSchemasRepository(),
		workflowEngine,
	);

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
		execute: ((_workflow, options) => {
			queuedEventCount++;
			return Effect.succeed(options.executionId);
		}) as WorkflowEngine["Type"]["execute"],
	});

	const layer = makeServiceLayer(
		Object.assign(Object.create(null), defaultCollectionsRepository(), {
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					id: "coll-id",
					createdAt: now,
					updatedAt: now,
					properties: {},
					entitySchemaId: "collection-schema-id",
				}),
			getEntityForMembership: () =>
				Effect.succeed({ id: "entity-id", userId: user.id, entitySchemaSlug: "book" }),
			upsertMembership: () => Effect.succeed(membership),
		}),
		defaultEntitiesRepository(),
		defaultRelationshipSchemasRepository(),
		workflowEngine,
	);

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		yield* service.addToCollection(user, { entityId: "entity-id", collectionId: "coll-id" });

		expect(queuedEventCount).toBe(0);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when removing entity not in collection", () => {
	const layer = makeServiceLayer(
		Object.assign(Object.create(null), defaultCollectionsRepository(), {
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					id: "coll-id",
					createdAt: now,
					updatedAt: now,
					properties: {},
					entitySchemaId: "collection-schema-id",
				}),
			getEntityForMembership: () =>
				Effect.succeed({ id: "entity-id", userId: user.id, entitySchemaSlug: "book" }),
			deleteMembership: () => Effect.succeed(null),
		}),
	);

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
		execute: ((_workflow, options) => {
			queuedEventCount++;
			return Effect.succeed(options.executionId);
		}) as WorkflowEngine["Type"]["execute"],
	});

	const layer = makeServiceLayer(
		Object.assign(Object.create(null), defaultCollectionsRepository(), {
			deleteMembership: () => Effect.succeed(deletedMembership),
			getEntityForMembership: () =>
				Effect.succeed({ id: "entity-id", userId: user.id, entitySchemaSlug: "book" }),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					id: "coll-id",
					createdAt: now,
					updatedAt: now,
					properties: {},
					entitySchemaId: "collection-schema-id",
				}),
		}),
		defaultEntitiesRepository(),
		defaultRelationshipSchemasRepository(),
		workflowEngine,
	);

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

	const collectionsRepository = Object.assign(defaultCollectionsRepository(), {
		getUserLibraryEntityId: () => Effect.succeed("library-entity-id"),
	});
	const entitiesRepository = Object.assign(defaultEntitiesRepository(), {
		findRelationshipProperties: () =>
			Effect.succeed({ owned: true, ownershipSources: ["plex_yank"] }),
		upsertRelationship: (input: { properties: Record<string, unknown> }) => {
			upserted = input;
			return Effect.succeed({ id: "rel-id" });
		},
	});

	const layer = makeServiceLayer(collectionsRepository, entitiesRepository);

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
