import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { BadRequest, Conflict, NotFound } from "#lib/errors";
import { EntitySchemaId, TrackerId, UserId } from "#lib/schema/brands";
import {
	dbRunnerLayer,
	makeMock,
	makeWorkflowEngine,
	transactionLayer,
} from "#lib/test-support/effect";
import { SandboxApiService } from "#modules/sandbox/service";
import { TrackersRepository } from "#modules/trackers/repository";

import { EntitySchemasRepository } from "./repository";
import { EntitySchemasService } from "./service";

const user = {
	id: UserId.make("user-id"),
	name: "Test User",
	email: "user@example.com",
} satisfies CurrentUserValue;

const makeSandboxApiService = () =>
	makeMock<SandboxApiService>({
		_tag: "SandboxApiService" as const,
		enqueue: () => Effect.die("not used in this test"),
		getResult: () => Effect.die("not used in this test"),
		createScript: () => Effect.die("not used in this test"),
	});

const fakeSandboxApiServiceLayer = Layer.succeed(SandboxApiService, makeSandboxApiService());

const makeTrackersRepository = (overrides: Partial<TrackersRepository> = {}) =>
	makeMock<TrackersRepository>(
		{
			_tag: "TrackersRepository" as const,
			create: () => Effect.die("unused"),
			listByUser: () => Effect.die("unused"),
			findBySlug: () => Effect.die("unused"),
			updateOwned: () => Effect.die("unused"),
			getOwnedById: () => Effect.die("unused"),
			persistOrder: () => Effect.die("unused"),
			listIdsInOrder: () => Effect.die("unused"),
			countOwnedByIds: () => Effect.die("unused"),
			linkEntitySchema: () => Effect.die("unused"),
		},
		overrides,
	);

const makeEntitySchemasRepository = (overrides: Partial<EntitySchemasRepository> = {}) =>
	makeMock<EntitySchemasRepository>(
		{
			_tag: "EntitySchemasRepository" as const,
			findBySlug: () => Effect.die("unused"),
			listByUser: () => Effect.die("unused"),
			getByIdForUser: () => Effect.die("unused"),
			listVisibleBySlugs: () => Effect.die("unused"),
			createEntitySchema: () => Effect.die("unused"),
		},
		overrides,
	);

const fakeWorkflowEngineLayer = Layer.succeed(
	WorkflowEngine,
	makeWorkflowEngine({ execute: () => Effect.void }),
);

const makeEntitySchemasServiceLayer = (
	repository: EntitySchemasRepository,
	trackers: TrackersRepository,
) =>
	EntitySchemasService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				fakeSandboxApiServiceLayer,
				fakeWorkflowEngineLayer,
				Layer.succeed(EntitySchemasRepository, repository),
				Layer.succeed(TrackersRepository, trackers),
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
