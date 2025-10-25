import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { BadRequest, NotFound } from "#lib/errors";
import { dbRunnerLayer, makeMock, transactionLayer } from "#lib/test-support/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { UserStateService } from "./service";

const user = {
	id: "user-id",
	name: "Test User",
	email: "user@example.com",
} satisfies CurrentUserValue;

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}) =>
	makeMock<EntitiesRepository>(
		{
			_tag: "EntitiesRepository" as const,
			getEntityScopeForUser: () => Effect.die("unused"),
			getEntityMergeScopeForUser: () => Effect.die("unused"),
		},
		overrides,
	);

const makeEventsRepository = (overrides: Partial<EventsRepository> = {}) =>
	makeMock<EventsRepository>(
		{
			_tag: "EventsRepository" as const,
			deleteUserEventsForEntity: () => Effect.die("unused"),
			moveUserEventsBetweenEntities: () => Effect.die("unused"),
		},
		overrides,
	);

const makeRelationshipsRepository = (overrides: Partial<RelationshipsRepository> = {}) =>
	makeMock<RelationshipsRepository>(
		{
			_tag: "RelationshipsRepository" as const,
			deleteUserRelationshipsForEntity: () => Effect.die("unused"),
			moveUserRelationshipsBetweenEntities: () => Effect.die("unused"),
		},
		overrides,
	);

const makeServiceLayer = (
	options: {
		eventsRepository?: EventsRepository;
		entitiesRepository?: EntitiesRepository;
		relationshipsRepository?: RelationshipsRepository;
	} = {},
) =>
	UserStateService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				Layer.succeed(EntitiesRepository, options.entitiesRepository ?? makeEntitiesRepository()),
				Layer.succeed(EventsRepository, options.eventsRepository ?? makeEventsRepository()),
				Layer.succeed(
					RelationshipsRepository,
					options.relationshipsRepository ?? makeRelationshipsRepository(),
				),
			),
		),
	);

const makeMergeScope = (overrides: {
	entityId: string;
	entitySchemaId?: string;
	entitySchemaSlug?: string;
	properties?: Record<string, unknown>;
}) => ({
	isBuiltin: false,
	entityUserId: user.id,
	entityId: overrides.entityId,
	properties: overrides.properties ?? {},
	entitySchemaSlug: overrides.entitySchemaSlug ?? "book",
	entitySchemaId: overrides.entitySchemaId ?? "schema-id",
});

it.effect("rejects clearing library user state", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () =>
				Effect.succeed({
					isBuiltin: true,
					entityUserId: user.id,
					entityId: "library-entity",
					entitySchemaSlug: "library",
					entitySchemaId: "library-schema",
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(service.clearUserState(user, "library-entity"));

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Library entity user state cannot be cleared" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects merging an entity into itself", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(
			service.mergeUserState(user, { mergeFrom: "entity-id", mergeInto: "entity-id" }),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Cannot merge an entity into itself" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when one merge entity is not visible", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(entityId === "from" ? makeMergeScope({ entityId }) : null),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(
			service.mergeUserState(user, { mergeFrom: "from", mergeInto: "into" }),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("rejects merging entities from different schemas", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(
					makeMergeScope({
						entityId,
						entitySchemaId: entityId === "from" ? "schema-a" : "schema-b",
					}),
				),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(
			service.mergeUserState(user, { mergeFrom: "from", mergeInto: "into" }),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Entities must belong to the same schema" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects merging exercises with different kinds", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(
					makeMergeScope({
						entityId,
						entitySchemaSlug: "exercise",
						properties: { kind: entityId === "from" ? "reps" : "duration" },
					}),
				),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(
			service.mergeUserState(user, { mergeFrom: "from", mergeInto: "into" }),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Exercises must have the same kind" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("moves events and relationships for valid merges", () => {
	const calls: string[] = [];
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) => Effect.succeed(makeMergeScope({ entityId })),
		}),
		eventsRepository: makeEventsRepository({
			moveUserEventsBetweenEntities: (input) =>
				Effect.sync(() => {
					calls.push(`${input.mergeFrom}->${input.mergeInto}:events`);
					return 2;
				}),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			moveUserRelationshipsBetweenEntities: (input) =>
				Effect.sync(() => {
					calls.push(`${input.mergeFrom}->${input.mergeInto}:relationships`);
					return 3;
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const result = yield* service.mergeUserState(user, { mergeFrom: "from", mergeInto: "into" });

		expect(result).toEqual({
			mergeFrom: "from",
			mergeInto: "into",
			movedEventsCount: 2,
			movedRelationshipsCount: 3,
		});
		expect(calls).toEqual(["from->into:events", "from->into:relationships"]);
	}).pipe(Effect.provide(layer));
});
