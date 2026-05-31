import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { BadRequest, Conflict, NotFound } from "#lib/errors";
import { EntitySchemaId, EventSchemaId, UserId } from "#lib/schema/brands";
import type { MockOverrides } from "#lib/test-support/effect";
import { dbRunnerLayer } from "#lib/test-support/effect";

import { EventSchemasRepository } from "./repository";
import { EventSchemasService } from "./service";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const mockEventSchemasRepository = Layer.mock(EventSchemasRepository);

const makeEventSchemasRepository = (
	overrides: MockOverrides<typeof mockEventSchemasRepository> = {},
) => mockEventSchemasRepository({ _tag: "EventSchemasRepository", ...overrides });

const makeEventSchemasServiceLayer = (repository: ReturnType<typeof makeEventSchemasRepository>) =>
	EventSchemasService.Default.pipe(Layer.provide(Layer.mergeAll(dbRunnerLayer, repository)));

it.effect("returns not found when entity schema does not exist during list", () => {
	const layer = makeEventSchemasServiceLayer(
		makeEventSchemasRepository({ getEntitySchemaScopeById: () => Effect.succeed(null) }),
	);

	return Effect.gen(function* () {
		const service = yield* EventSchemasService;
		const exit = yield* Effect.exit(
			service.list(user, { entitySchemaId: EntitySchemaId.make("schema-id") }),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity schema not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request when entity schema is built-in during creation", () => {
	const layer = makeEventSchemasServiceLayer(
		makeEventSchemasRepository({
			getEntitySchemaScopeById: () =>
				Effect.succeed({
					slug: "book",
					userId: null,
					isBuiltin: true,
					id: EntitySchemaId.make("schema-id"),
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EventSchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				name: "My Event",
				slug: "my-event",
				entitySchemaId: EntitySchemaId.make("schema-id"),
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
				Effect.succeed({
					id: EntitySchemaId.make("schema-id"),
					slug: "custom",
					userId: user.id,
					isBuiltin: false,
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EventSchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				name: "My Event",
				slug: "my-event",
				entitySchemaId: EntitySchemaId.make("schema-id"),
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
			findBySlugForUser: () => Effect.succeed({ id: EventSchemaId.make("existing-id") }),
			getEntitySchemaScopeById: () =>
				Effect.succeed({
					id: EntitySchemaId.make("schema-id"),
					slug: "custom",
					userId: user.id,
					isBuiltin: false,
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EventSchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				name: "My Event",
				entitySchemaId: EntitySchemaId.make("schema-id"),
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
				Effect.succeed({
					slug: "book",
					userId: user.id,
					id: EntitySchemaId.make("schema-id"),
					isBuiltin: false,
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EventSchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				name: "My Event",
				slug: "progress",
				entitySchemaId: EntitySchemaId.make("schema-id"),
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
						id: EventSchemaId.make("schema-id"),
						name: input.name,
						slug: input.slug,
						entitySchemaId: input.entitySchemaId,
						propertiesSchema: input.propertiesSchema,
					};
				}),
			findBySlugForUser: () => Effect.succeed(null),
			getEntitySchemaScopeById: () =>
				Effect.succeed({
					slug: "custom",
					id: EntitySchemaId.make("schema-id"),
					userId: user.id,
					isBuiltin: false,
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EventSchemasService;
		const schema = yield* service.create(user, {
			name: " My Cool Event ",
			entitySchemaId: EntitySchemaId.make("schema-id"),
			propertiesSchema: {
				fields: { note: { type: "string", label: "Note", description: "Note" } },
			},
		});

		expect(createdSlug).toBe("my-cool-event");
		expect(schema.slug).toBe("my-cool-event");
	}).pipe(Effect.provide(layer));
});
