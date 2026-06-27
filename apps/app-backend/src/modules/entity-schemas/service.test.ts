import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, Conflict, NotFound } from "@ryot/contract/errors";
import { EntitySchemaId, TrackerId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer, makeWorkflowEngine, transactionLayer } from "#lib/test-utils/effect";
import { SandboxApiService } from "#modules/sandbox/service";
import { TrackersRepository } from "#modules/trackers/repository";
import { TrackersService } from "#modules/trackers/service";

import { EntitySchemasRepository } from "./repository";
import { EntitySchemasService } from "./service";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const mockSandboxApiService = Layer.mock(SandboxApiService);

const fakeSandboxApiServiceLayer = mockSandboxApiService({ _tag: "SandboxApiService" });

const mockTrackersRepository = Layer.mock(TrackersRepository);

const makeTrackersRepository = (overrides: MockOverrides<typeof mockTrackersRepository> = {}) =>
	mockTrackersRepository({ _tag: "TrackersRepository", ...overrides });

const mockTrackersService = Layer.mock(TrackersService);

const makeTrackersService = (overrides: MockOverrides<typeof mockTrackersService> = {}) =>
	mockTrackersService({
		_tag: "TrackersService",
		linkEntitySchema: () => Effect.succeed(TrackerId.make("tracker-id")),
		...overrides,
	});

const mockEntitySchemasRepository = Layer.mock(EntitySchemasRepository);

const makeEntitySchemasRepository = (
	overrides: MockOverrides<typeof mockEntitySchemasRepository> = {},
) => mockEntitySchemasRepository({ _tag: "EntitySchemasRepository", ...overrides });

const fakeWorkflowEngineLayer = Layer.succeed(
	WorkflowEngine,
	makeWorkflowEngine({ execute: () => Effect.void.pipe(Effect.as(undefined)) }),
);

const makeEntitySchemasServiceLayer = (
	repository: ReturnType<typeof makeEntitySchemasRepository>,
	trackers: ReturnType<typeof makeTrackersRepository>,
) =>
	EntitySchemasService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				fakeSandboxApiServiceLayer,
				fakeWorkflowEngineLayer,
				repository,
				trackers,
				makeTrackersService(),
			),
		),
	);

it.effect("returns not found when tracker does not exist during creation", () => {
	const layer = makeEntitySchemasServiceLayer(
		makeEntitySchemasRepository(),
		makeTrackersRepository({ getOwnedById: () => Effect.succeed(null) }),
	);

	return Effect.gen(function* () {
		const service = yield* EntitySchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				icon: "rocket",
				name: "My Schema",
				accentColor: "#FF5733",
				trackerId: TrackerId.make("tracker-id"),
				propertiesSchema: {
					fields: { name: { type: "string", label: "Name", description: "Name" } },
				},
			}),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Tracker not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request when tracker is built-in during creation", () => {
	const layer = makeEntitySchemasServiceLayer(
		makeEntitySchemasRepository(),
		makeTrackersRepository({
			getOwnedById: () =>
				Effect.succeed({
					icon: "film",
					slug: "media",
					name: "Media",
					isBuiltin: true,
					description: null,
					accentColor: "#000000",
					id: TrackerId.make("tracker-id"),
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitySchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				icon: "rocket",
				name: "My Schema",
				accentColor: "#FF5733",
				trackerId: TrackerId.make("tracker-id"),
				propertiesSchema: {
					fields: { name: { type: "string", label: "Name", description: "Name" } },
				},
			}),
		);

		expect(exit).toEqual(
			Exit.fail(
				new BadRequest({ message: "Built-in trackers do not support entity schema creation" }),
			),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns conflict when entity schema slug already exists", () => {
	const layer = makeEntitySchemasServiceLayer(
		makeEntitySchemasRepository({
			findBySlug: () => Effect.succeed({ id: EntitySchemaId.make("existing-id") }),
		}),
		makeTrackersRepository({
			getOwnedById: () =>
				Effect.succeed({
					icon: "star",
					name: "Custom",
					slug: "custom",
					isBuiltin: false,
					description: null,
					accentColor: "#000000",
					id: TrackerId.make("tracker-id"),
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitySchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				icon: "rocket",
				name: "My Schema",
				accentColor: "#FF5733",
				trackerId: TrackerId.make("tracker-id"),
				propertiesSchema: {
					fields: { name: { type: "string", label: "Name", description: "Name" } },
				},
			}),
		);

		expect(exit).toEqual(Exit.fail(new Conflict({ message: "Entity schema slug already exists" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request for reserved slug", () => {
	const layer = makeEntitySchemasServiceLayer(
		makeEntitySchemasRepository(),
		makeTrackersRepository({
			getOwnedById: () =>
				Effect.succeed({
					icon: "star",
					slug: "custom",
					name: "Custom",
					isBuiltin: false,
					description: null,
					accentColor: "#000000",
					id: TrackerId.make("tracker-id"),
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitySchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				name: "Book",
				icon: "rocket",
				accentColor: "#FF5733",
				trackerId: TrackerId.make("tracker-id"),
				propertiesSchema: {
					fields: { name: { type: "string", label: "Name", description: "Name" } },
				},
			}),
		);

		expect(exit).toEqual(
			Exit.fail(
				new BadRequest({ message: 'Entity schema slug "book" is reserved for built-in schemas' }),
			),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("normalizes slugs before creating entity schemas", () => {
	let createdSlug = "";

	const layer = makeEntitySchemasServiceLayer(
		makeEntitySchemasRepository({
			findBySlug: () => Effect.succeed(null),
			createEntitySchema: (input) =>
				Effect.sync(() => {
					createdSlug = input.slug;
					return {
						name: input.name,
						icon: input.icon,
						slug: input.slug,
						isBuiltin: false,
						accentColor: input.accentColor,
						id: EntitySchemaId.make("schema-id"),
						propertiesSchema: input.propertiesSchema,
					};
				}),
		}),
		makeTrackersRepository({
			linkEntitySchema: () => Effect.succeed(TrackerId.make("tracker-id")),
			getOwnedById: () =>
				Effect.succeed({
					icon: "star",
					slug: "custom",
					name: "Custom",
					isBuiltin: false,
					description: null,
					accentColor: "#000000",
					id: TrackerId.make("tracker-id"),
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitySchemasService;
		const schema = yield* service.create(user, {
			icon: "rocket",
			accentColor: "#FF5733",
			name: " My Cool Schema ",
			trackerId: TrackerId.make("tracker-id"),
			propertiesSchema: {
				fields: { name: { type: "string", label: "Name", description: "Name" } },
			},
		});

		expect(createdSlug).toBe("my-cool-schema");
		expect(schema.slug).toBe("my-cool-schema");
	}).pipe(Effect.provide(layer));
});
