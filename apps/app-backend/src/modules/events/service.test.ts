import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "../../lib/auth";
import { CurrentDb, DbRunner } from "../../lib/db";
import { BadRequest, NotFound } from "../../lib/errors";
import { EntitiesRepository } from "../entities/repository";
import { EventSchemasRepository } from "../event-schemas/repository";
import { EventsRepository } from "./repository";
import { EventsService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

const user = {
	id: "user-id",
	name: "Test User",
	email: "user@example.com",
} satisfies CurrentUserValue;

const entityScope = {
	isBuiltin: false,
	entityId: "entity-1",
	entityUserId: user.id,
	entitySchemaSlug: "book",
	entitySchemaId: "entity-schema-1",
};

const eventSchemaScope = {
	slug: "finished",
	name: "Finished",
	id: "event-schema-1",
	entitySchemaId: "entity-schema-1",
	propertiesSchema: {
		fields: {
			rating: {
				label: "Rating",
				description: "Rating",
				type: "number" as const,
				validation: { required: true as const },
			},
		},
	},
};

const dbRunnerLayer = Layer.succeed(
	DbRunner,
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, CurrentDb>> =>
		Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const defaultEntitiesRepository = (): EntitiesRepository =>
	Object.assign(Object.create(null), {
		_tag: "EntitiesRepository" as const,
		createEntity: () => Effect.die("unused"),
		getByIdForUser: () => Effect.die("unused"),
		getEntityScopeById: () => Effect.die("unused"),
		insertRelationship: () => Effect.die("unused"),
		upsertRelationship: () => Effect.die("unused"),
		getEntityScopeForUser: () => Effect.die("unused"),
		upsertEntityRelationship: () => Effect.die("unused"),
		deleteUserEventsForEntity: () => Effect.die("unused"),
		getEntitySchemaScopeForUser: () => Effect.die("unused"),
		findEntityByExternalIdForUser: () => Effect.die("unused"),
		deleteUserRelationshipsForEntity: () => Effect.die("unused"),
	});

const defaultEventSchemasRepository = (): EventSchemasRepository =>
	Object.assign(Object.create(null), {
		_tag: "EventSchemasRepository" as const,
		getScopeForUser: () => Effect.die("unused"),
		createEventSchema: () => Effect.die("unused"),
		findBySlugForUser: () => Effect.die("unused"),
		getEntitySchemaScopeById: () => Effect.die("unused"),
		listByEntitySchemaForUser: () => Effect.die("unused"),
	});

const defaultEventsRepository = (): EventsRepository =>
	Object.assign(Object.create(null), {
		_tag: "EventsRepository" as const,
		listForUser: () => Effect.die("unused"),
		createEvent: () => Effect.die("unused"),
	});

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}): EntitiesRepository =>
	Object.assign(Object.create(null), defaultEntitiesRepository(), overrides);

const makeEventSchemasRepository = (
	overrides: Partial<EventSchemasRepository> = {},
): EventSchemasRepository =>
	Object.assign(Object.create(null), defaultEventSchemasRepository(), overrides);

const makeEventsRepository = (overrides: Partial<EventsRepository> = {}): EventsRepository =>
	Object.assign(Object.create(null), defaultEventsRepository(), overrides);

const makeServiceLayer = (input: {
	eventsRepository?: EventsRepository;
	entitiesRepository?: EntitiesRepository;
	eventSchemasRepository?: EventSchemasRepository;
}) =>
	EventsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				Layer.succeed(EntitiesRepository, input.entitiesRepository ?? makeEntitiesRepository()),
				Layer.succeed(
					EventSchemasRepository,
					input.eventSchemasRepository ?? makeEventSchemasRepository(),
				),
				Layer.succeed(EventsRepository, input.eventsRepository ?? makeEventsRepository()),
			),
		),
	);

it.effect("requires entityId or sessionEntityId when listing events", () => {
	const layer = makeServiceLayer({});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(service.list(user, {}));

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Either entityId or sessionEntityId is required" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when listing events for an inaccessible entity", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(null),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(service.list(user, { entityId: "entity-1" }));

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when listing events for an inaccessible session entity", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(null),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(service.list(user, { sessionEntityId: "session-entity-1" }));

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Session entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("lists events for an accessible entity", () => {
	const events = [
		{
			id: "event-1",
			createdAt: now,
			updatedAt: now,
			occurredAt: now,
			entityId: "entity-1",
			properties: { rating: 5 },
			eventSchemaName: "Finished",
			eventSchemaSlug: "finished",
			eventSchemaId: "event-schema-1",
		},
	];

	const layer = makeServiceLayer({
		eventsRepository: makeEventsRepository({ listForUser: () => Effect.succeed(events) }),
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const result = yield* service.list(user, { entityId: "entity-1" });

		expect(result).toEqual(events);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when creating an event for an inaccessible entity", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(null),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(
			service.create(user, [
				{ properties: {}, entityId: "entity-1", eventSchemaId: "event-schema-1" },
			]),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when the event schema is not visible to the user", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(null),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(
			service.create(user, [
				{ properties: {}, entityId: "entity-1", eventSchemaId: "event-schema-1" },
			]),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Event schema not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request when the event schema does not belong to the entity schema", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () =>
				Effect.succeed({ ...eventSchemaScope, entitySchemaId: "other-entity-schema" }),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(
			service.create(user, [
				{ properties: {}, entityId: "entity-1", eventSchemaId: "event-schema-1" },
			]),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Event schema does not belong to the entity schema" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when the session entity is not accessible", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: ({ entityId }) =>
				Effect.succeed(entityId === "entity-1" ? entityScope : null),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(
			service.create(user, [
				{
					entityId: "entity-1",
					properties: { rating: 5 },
					eventSchemaId: "event-schema-1",
					sessionEntityId: "session-entity-1",
				},
			]),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Session entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request when event properties fail schema validation", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(
			service.create(user, [
				{ properties: {}, entityId: "entity-1", eventSchemaId: "event-schema-1" },
			]),
		);

		expect(exit).toEqual(Exit.fail(new BadRequest({ message: "rating: is missing" })));
	}).pipe(Effect.provide(layer));
});

it.effect("creates events with resolved scope and returns the created count", () => {
	const createCalls: unknown[] = [];
	const occurredAt = new Date("2026-01-01T00:00:00.000Z");

	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
		eventsRepository: makeEventsRepository({
			createEvent: (input) =>
				Effect.sync(() => {
					createCalls.push(input);
					return {
						id: "event-1",
						createdAt: now,
						updatedAt: now,
						entityId: input.entityId,
						properties: input.properties,
						eventSchemaId: input.eventSchemaId,
						eventSchemaName: input.eventSchemaName,
						eventSchemaSlug: input.eventSchemaSlug,
						sessionEntityId: input.sessionEntityId,
						occurredAt: input.occurredAt.toISOString(),
					};
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const result = yield* service.create(user, [
			{
				entityId: "entity-1",
				properties: { rating: 5 },
				eventSchemaId: "event-schema-1",
				occurredAt: "2026-01-01T00:00:00.000Z",
			},
		]);

		expect(result).toEqual({ count: 1 });
		expect(createCalls).toEqual([
			{
				occurredAt,
				userId: user.id,
				entityId: "entity-1",
				properties: { rating: 5 },
				sessionEntityId: undefined,
				eventSchemaName: "Finished",
				eventSchemaSlug: "finished",
				eventSchemaId: "event-schema-1",
			},
		]);
	}).pipe(Effect.provide(layer));
});
