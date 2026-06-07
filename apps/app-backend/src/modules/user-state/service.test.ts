import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { CurrentDb, DbRunner, TransactionRunner } from "#lib/db";
import { BadRequest } from "#lib/errors";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { UserStateService } from "./service";

const user = {
	id: "user-id",
	name: "Test User",
	email: "user@example.com",
} satisfies CurrentUserValue;

const dbRunnerLayer = Layer.succeed(DbRunner, <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const transactionLayer = Layer.succeed(
	TransactionRunner,
	<A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const defaultEntitiesRepository = () =>
	Object.assign(Object.create(null), {
		_tag: "EntitiesRepository" as const,
		getEntityScopeForUser: () => Effect.die("unused"),
	});

const defaultEventsRepository = () =>
	Object.assign(Object.create(null), {
		_tag: "EventsRepository" as const,
		deleteUserEventsForEntity: () => Effect.die("unused"),
	});

const defaultRelationshipsRepository = () =>
	Object.assign(Object.create(null), {
		_tag: "RelationshipsRepository" as const,
		deleteUserRelationshipsForEntity: () => Effect.die("unused"),
	});

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}) =>
	Object.assign(Object.create(null), defaultEntitiesRepository(), overrides);

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
				Layer.succeed(EventsRepository, options.eventsRepository ?? defaultEventsRepository()),
				Layer.succeed(
					RelationshipsRepository,
					options.relationshipsRepository ?? defaultRelationshipsRepository(),
				),
			),
		),
	);

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
