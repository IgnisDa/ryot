import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { BadRequest, Conflict, NotFound } from "#lib/errors";
import { dbRunnerLayer, makeMock } from "#lib/test-support/effect";

import { EventSchemasRepository } from "./repository";
import { EventSchemasService } from "./service";

const user = {
	id: "user-id",
	name: "Test User",
	email: "user@example.com",
} satisfies CurrentUserValue;

const makeEventSchemasRepository = (overrides: Partial<EventSchemasRepository> = {}) =>
	makeMock<EventSchemasRepository>(
		{
			_tag: "EventSchemasRepository" as const,
			createEventSchema: () => Effect.die("unused"),
			findBySlugForUser: () => Effect.die("unused"),
			getEntitySchemaScopeById: () => Effect.die("unused"),
			listByEntitySchemaForUser: () => Effect.die("unused"),
		},
		overrides,
	);

const makeEventSchemasServiceLayer = (repository: EventSchemasRepository) =>
	EventSchemasService.Default.pipe(
		Layer.provide(Layer.mergeAll(dbRunnerLayer, Layer.succeed(EventSchemasRepository, repository))),
	);

it.effect("returns not found when entity schema does not exist during list", () => {
	const layer = makeEventSchemasServiceLayer(
		makeEventSchemasRepository({ getEntitySchemaScopeById: () => Effect.succeed(null) }),
	);

	return Effect.gen(function* () {
		const service = yield* EventSchemasService;
		const exit = yield* Effect.exit(service.list(user, { entitySchemaId: "schema-id" }));

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity schema not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request when entity schema is built-in during creation", () => {
	const layer = makeEventSchemasServiceLayer(
		makeEventSchemasRepository({
			getEntitySchemaScopeById: () =>
				Effect.succeed({ slug: "book", userId: null, isBuiltin: true, id: "schema-id" }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EventSchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				name: "My Event",
				slug: "my-event",
				entitySchemaId: "schema-id",
				propertiesSchema: {
					fields: { note: { type: "string", label: "Note", description: "Note" } },
				},
			}),
		);

		expect(exit).toEqual(
			Exit.fail(
				new BadRequest({ message: "Built-in entity schemas do not support event schema creation" }),
			),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request for invalid properties schema", () => {
	const layer = makeEventSchemasServiceLayer(
		makeEventSchemasRepository({
			findBySlugForUser: () => Effect.succeed(null),
			getEntitySchemaScopeById: () =>
				Effect.succeed({ id: "schema-id", slug: "custom", userId: user.id, isBuiltin: false }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EventSchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				name: "My Event",
				slug: "my-event",
				entitySchemaId: "schema-id",
				propertiesSchema: {
					fields: { status: { type: "string", label: "Status", description: "Status" } },
					rules: [
						{
							path: ["missing"],
							kind: "validation",
							validation: { required: true },
							when: { operator: "eq", path: ["status"], value: "completed" },
						},
					],
				},
			}),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Rule path 'missing' does not exist" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns conflict when event schema slug already exists", () => {
	const layer = makeEventSchemasServiceLayer(
		makeEventSchemasRepository({
			findBySlugForUser: () => Effect.succeed({ id: "existing-id" }),
			getEntitySchemaScopeById: () =>
				Effect.succeed({ id: "schema-id", slug: "custom", userId: user.id, isBuiltin: false }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EventSchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				name: "My Event",
				entitySchemaId: "schema-id",
				slug: "duplicate-event-slug",
				propertiesSchema: {
					fields: { note: { type: "string", label: "Note", description: "Note" } },
				},
			}),
		);

		expect(exit).toEqual(Exit.fail(new Conflict({ message: "Event schema slug already exists" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request for reserved slug", () => {
	const layer = makeEventSchemasServiceLayer(
		makeEventSchemasRepository({
			getEntitySchemaScopeById: () =>
				Effect.succeed({ slug: "book", userId: user.id, id: "schema-id", isBuiltin: false }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EventSchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				name: "My Event",
				slug: "progress",
				entitySchemaId: "schema-id",
				propertiesSchema: {
					fields: { note: { type: "string", label: "Note", description: "Note" } },
				},
			}),
		);

		expect(exit).toEqual(
			Exit.fail(
				new BadRequest({
					message: 'Event schema slug "progress" is reserved for built-in schemas',
				}),
			),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("normalizes slugs before creating event schemas", () => {
	let createdSlug = "";

	const layer = makeEventSchemasServiceLayer(
		makeEventSchemasRepository({
			createEventSchema: (input) =>
				Effect.sync(() => {
					createdSlug = input.slug;
					return {
						id: "schema-id",
						name: input.name,
						slug: input.slug,
						entitySchemaId: input.entitySchemaId,
						propertiesSchema: input.propertiesSchema,
					};
				}),
			findBySlugForUser: () => Effect.succeed(null),
			getEntitySchemaScopeById: () =>
				Effect.succeed({ slug: "custom", id: "schema-id", userId: user.id, isBuiltin: false }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EventSchemasService;
		const schema = yield* service.create(user, {
			name: " My Cool Event ",
			entitySchemaId: "schema-id",
			propertiesSchema: {
				fields: { note: { type: "string", label: "Note", description: "Note" } },
			},
		});

		expect(createdSlug).toBe("my-cool-event");
		expect(schema.slug).toBe("my-cool-event");
	}).pipe(Effect.provide(layer));
});
