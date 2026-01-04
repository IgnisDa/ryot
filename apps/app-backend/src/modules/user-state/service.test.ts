import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { BadRequest } from "#lib/errors";
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
		},
		overrides,
	);

const makeEventsRepository = (overrides: Partial<EventsRepository> = {}) =>
	makeMock<EventsRepository>(
		{
			_tag: "EventsRepository" as const,
			deleteUserEventsForEntity: () => Effect.die("unused"),
		},
		overrides,
	);

const makeRelationshipsRepository = (overrides: Partial<RelationshipsRepository> = {}) =>
	makeMock<RelationshipsRepository>(
		{
			_tag: "RelationshipsRepository" as const,
			deleteUserRelationshipsForEntity: () => Effect.die("unused"),
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
