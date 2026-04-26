import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import type { CurrentUserValue } from "~/lib/auth";
import { CurrentDb, DbRunner, TransactionRunner } from "~/lib/db";
import { BadRequest, NotFound } from "~/lib/errors";
import { EntitiesRepository } from "~/modules/entities/repository";
import { EventsRepository } from "~/modules/events/repository";
import type { ListedEvent } from "~/modules/events/schemas";
import { RelationshipSchemasRepository } from "~/modules/relationship-schemas/repository";

import { CollectionsRepository } from "./repository";
import { CollectionsService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

const user: CurrentUserValue = {
	id: "user-id",
	name: "Test User",
	email: "user@example.com",
};

const dbRunnerLayer = Layer.succeed(
	DbRunner,
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, CurrentDb>> =>
		Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const transactionLayer = Layer.succeed(
	TransactionRunner,
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, CurrentDb>> =>
		Effect.provideService(effect, CurrentDb, Object.create(null)),
);

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

const defaultCollectionsRepository = (): CollectionsRepository =>
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

const defaultRelationshipSchemasRepository = (): RelationshipSchemasRepository =>
	Object.assign(Object.create(null), {
		findById: () => Effect.die("unused"),
		_tag: "RelationshipSchemasRepository" as const,
		findBuiltinBySlug: (slug: string) =>
			slug === "member-of" ? Effect.succeed(memberOfSchema) : Effect.succeed(inLibrarySchema),
	});

const defaultEntitiesRepository = (): EntitiesRepository =>
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

const defaultEventsRepository = (): EventsRepository =>
	Object.assign(Object.create(null), {
		_tag: "EventsRepository" as const,
		listForUser: () => Effect.die("unused"),
		createEvent: () => Effect.die("unused"),
	});

const makeServiceLayer = (
	collectionsRepository: CollectionsRepository = defaultCollectionsRepository(),
	entitiesRepository: EntitiesRepository = defaultEntitiesRepository(),
	eventsRepository: EventsRepository = defaultEventsRepository(),
	relationshipSchemasRepository: RelationshipSchemasRepository = defaultRelationshipSchemasRepository(),
) =>
	CollectionsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				Layer.succeed(CollectionsRepository, collectionsRepository),
				Layer.succeed(EntitiesRepository, entitiesRepository),
				Layer.succeed(EventsRepository, eventsRepository),
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
	let eventCreatedCount = 0;

	const membership = {
		id: "rel-id",
		createdAt: now,
		properties: {},
		wasInserted: true,
		targetEntityId: "coll-id",
		sourceEntityId: "entity-id",
		relationshipSchemaId: "member-of-schema-id",
	};

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
		Object.assign(Object.create(null), defaultEventsRepository(), {
			createEvent: () => {
				eventCreatedCount++;
				return Effect.succeed({
					id: "event-id",
					properties: {},
					createdAt: now,
					updatedAt: now,
					occurredAt: now,
					entityId: "coll-id",
					eventSchemaId: addEventSchema.id,
					eventSchemaName: addEventSchema.name,
					eventSchemaSlug: addEventSchema.slug,
				} as ListedEvent);
			},
		}),
	);

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		yield* service.addToCollection(user, { entityId: "entity-id", collectionId: "coll-id" });

		expect(eventCreatedCount).toBe(1);
	}).pipe(Effect.provide(layer));
});

it.effect("does not create membership event on upsert update", () => {
	let eventCreatedCount = 0;

	const membership = {
		id: "rel-id",
		createdAt: now,
		properties: {},
		wasInserted: false,
		targetEntityId: "coll-id",
		sourceEntityId: "entity-id",
		relationshipSchemaId: "member-of-schema-id",
	};

	const layer = makeServiceLayer(
		Object.assign(Object.create(null), defaultCollectionsRepository(), {
			getCollectionById: () =>
				Effect.succeed({
					id: "coll-id",
					name: "Coll",
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
		Object.assign(Object.create(null), defaultEventsRepository(), {
			createEvent: () => {
				eventCreatedCount++;
				return Effect.succeed({
					id: "dummy",
					properties: {},
					createdAt: now,
					updatedAt: now,
					occurredAt: now,
					entityId: "dummy",
					eventSchemaId: "dummy",
					eventSchemaName: "dummy",
					eventSchemaSlug: "dummy",
				});
			},
		}),
	);

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		yield* service.addToCollection(user, { entityId: "entity-id", collectionId: "coll-id" });

		expect(eventCreatedCount).toBe(0);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when removing entity not in collection", () => {
	const layer = makeServiceLayer(
		Object.assign(Object.create(null), defaultCollectionsRepository(), {
			getCollectionById: () =>
				Effect.succeed({
					id: "coll-id",
					name: "Coll",
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
	let eventCreatedCount = 0;

	const deletedMembership = {
		id: "rel-id",
		createdAt: now,
		properties: {},
		targetEntityId: "coll-id",
		sourceEntityId: "entity-id",
		relationshipSchemaId: "member-of-schema-id",
	};

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
		Object.assign(Object.create(null), defaultEventsRepository(), {
			createEvent: () => {
				eventCreatedCount++;
				return Effect.succeed({
					createdAt: now,
					updatedAt: now,
					id: "event-id",
					properties: {},
					occurredAt: now,
					entityId: "coll-id",
					eventSchemaId: removeEventSchema.id,
					eventSchemaName: removeEventSchema.name,
					eventSchemaSlug: removeEventSchema.slug,
				} as ListedEvent);
			},
		}),
	);

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const result = yield* service.removeFromCollection(user, {
			entityId: "entity-id",
			collectionId: "coll-id",
		});

		expect(eventCreatedCount).toBe(1);
		expect(result.memberOf.id).toBe("rel-id");
	}).pipe(Effect.provide(layer));
});
