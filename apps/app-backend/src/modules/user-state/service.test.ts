import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { BadRequest, NotFound } from "#lib/errors";
import { EntityId, EntitySchemaId, UserId } from "#lib/schema/brands";
import type { MockOverrides } from "#lib/test-support/effect";
import { dbRunnerLayer, transactionLayer } from "#lib/test-support/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { UserStateService } from "./service";

const user = {
	id: UserId.make("user-id"),
	name: "Test User",
	email: "user@example.com",
} satisfies CurrentUserValue;

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({
		...overrides,
		_tag: "EntitiesRepository",
	});

const mockEventsRepository = Layer.mock(EventsRepository);

const makeEventsRepository = (overrides: MockOverrides<typeof mockEventsRepository> = {}) =>
	mockEventsRepository({
		...overrides,
		_tag: "EventsRepository",
	});

const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);

const makeRelationshipsRepository = (
	overrides: MockOverrides<typeof mockRelationshipsRepository> = {},
) =>
	mockRelationshipsRepository({
		...overrides,
		_tag: "RelationshipsRepository",
	});

const makeServiceLayer = (
	options: {
		eventsRepository?: ReturnType<typeof makeEventsRepository>;
		entitiesRepository?: ReturnType<typeof makeEntitiesRepository>;
		relationshipsRepository?: ReturnType<typeof makeRelationshipsRepository>;
	} = {},
) =>
	UserStateService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				options.entitiesRepository ?? makeEntitiesRepository(),
				options.eventsRepository ?? makeEventsRepository(),
				options.relationshipsRepository ?? makeRelationshipsRepository(),
			),
		),
	);

const makeMergeScope = (overrides: {
	entityId: EntityId;
	entitySchemaId?: EntitySchemaId;
	entitySchemaSlug?: string;
	properties?: Record<string, unknown>;
}) => ({
	isBuiltin: false,
	entityUserId: user.id,
	entityId: overrides.entityId,
	properties: overrides.properties ?? {},
	entitySchemaSlug: overrides.entitySchemaSlug ?? "book",
	entitySchemaId: overrides.entitySchemaId ?? EntitySchemaId.make("schema-id"),
});

it.effect("rejects clearing library user state", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () =>
				Effect.succeed({
					isBuiltin: true,
					entityUserId: user.id,
					entityId: EntityId.make("library-entity"),
					entitySchemaSlug: "library",
					entitySchemaId: EntitySchemaId.make("library-schema"),
					propertiesSchema: { fields: {} },
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(service.clearUserState(user, EntityId.make("library-entity")));

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
			service.mergeUserState(user, {
				mergeFrom: EntityId.make("entity-id"),
				mergeInto: EntityId.make("entity-id"),
			}),
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
			service.mergeUserState(user, {
				mergeFrom: EntityId.make("from"),
				mergeInto: EntityId.make("into"),
			}),
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
						entitySchemaId:
							entityId === "from"
								? EntitySchemaId.make("schema-a")
								: EntitySchemaId.make("schema-b"),
					}),
				),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(
			service.mergeUserState(user, {
				mergeFrom: EntityId.make("from"),
				mergeInto: EntityId.make("into"),
			}),
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
			service.mergeUserState(user, {
				mergeFrom: EntityId.make("from"),
				mergeInto: EntityId.make("into"),
			}),
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
		const result = yield* service.mergeUserState(user, {
			mergeFrom: EntityId.make("from"),
			mergeInto: EntityId.make("into"),
		});

		expect(result).toEqual({
			mergeFrom: "from",
			mergeInto: "into",
			movedEventsCount: 2,
			movedRelationshipsCount: 3,
		});
		expect(calls).toEqual(["from->into:events", "from->into:relationships"]);
	}).pipe(Effect.provide(layer));
});
