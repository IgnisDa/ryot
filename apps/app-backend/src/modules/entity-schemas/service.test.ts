import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { BadRequest, Conflict, NotFound } from "#lib/errors";
import { dbRunnerLayer, makeMock, transactionLayer } from "#lib/test-support/effect";
import { SandboxApiService } from "#modules/sandbox/service";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { TrackersRepository } from "#modules/trackers/repository";

import { EntitySchemasRepository } from "./repository";
import { EntitySchemasService } from "./service";

const user = {
	id: "user-id",
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
			createEntitySchema: () => Effect.die("unused"),
		},
		overrides,
	);

const makeSavedViewsRepository = (overrides: Partial<SavedViewsRepository> = {}) =>
	makeMock<SavedViewsRepository>(
		{
			_tag: "SavedViewsRepository" as const,
			create: () => Effect.die("unused"),
			findBySlug: () => Effect.die("unused"),
			listByUser: () => Effect.die("unused"),
			deleteBySlug: () => Effect.die("unused"),
			updateBySlug: () => Effect.die("unused"),
			countBySlugs: () => Effect.die("unused"),
			persistOrder: () => Effect.die("unused"),
			listSlugsInOrder: () => Effect.die("unused"),
			updateDisabledBySlug: () => Effect.die("unused"),
			createDefaultViewForSchema: () => Effect.die("unused"),
		},
		overrides,
	);

const makeEntitySchemasServiceLayer = (
	repository: EntitySchemasRepository,
	trackers: TrackersRepository,
	savedViews: SavedViewsRepository = makeSavedViewsRepository(),
) =>
	EntitySchemasService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				fakeSandboxApiServiceLayer,
				Layer.succeed(EntitySchemasRepository, repository),
				Layer.succeed(TrackersRepository, trackers),
				Layer.succeed(SavedViewsRepository, savedViews),
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
				trackerId: "tracker-id",
				accentColor: "#FF5733",
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
					id: "tracker-id",
					description: null,
					accentColor: "#000000",
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitySchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				icon: "rocket",
				name: "My Schema",
				trackerId: "tracker-id",
				accentColor: "#FF5733",
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
		makeEntitySchemasRepository({ findBySlug: () => Effect.succeed({ id: "existing-id" }) }),
		makeTrackersRepository({
			getOwnedById: () =>
				Effect.succeed({
					icon: "star",
					name: "Custom",
					slug: "custom",
					isBuiltin: false,
					id: "tracker-id",
					description: null,
					accentColor: "#000000",
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitySchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				icon: "rocket",
				name: "My Schema",
				trackerId: "tracker-id",
				accentColor: "#FF5733",
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
					id: "tracker-id",
					description: null,
					accentColor: "#000000",
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitySchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				icon: "rocket",
				name: "Book",
				trackerId: "tracker-id",
				accentColor: "#FF5733",
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

it.effect("returns conflict when default saved view creation conflicts", () => {
	const layer = makeEntitySchemasServiceLayer(
		makeEntitySchemasRepository({
			findBySlug: () => Effect.succeed(null),
			createEntitySchema: (input) =>
				Effect.succeed({
					id: "schema-id",
					name: input.name,
					icon: input.icon,
					slug: input.slug,
					isBuiltin: false,
					accentColor: input.accentColor,
					propertiesSchema: input.propertiesSchema,
				}),
		}),
		makeTrackersRepository({
			getOwnedById: () =>
				Effect.succeed({
					icon: "star",
					slug: "custom",
					name: "Custom",
					id: "tracker-id",
					isBuiltin: false,
					description: null,
					accentColor: "#000000",
				}),
			linkEntitySchema: () => Effect.succeed("tracker-id"),
		}),
		makeSavedViewsRepository({
			createDefaultViewForSchema: () =>
				Effect.fail(new Conflict({ message: "Entity schema default saved view already exists" })),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitySchemasService;
		const exit = yield* Effect.exit(
			service.create(user, {
				icon: "rocket",
				name: "My Schema",
				trackerId: "tracker-id",
				accentColor: "#FF5733",
				propertiesSchema: {
					fields: { name: { type: "string", label: "Name", description: "Name" } },
				},
			}),
		);

		expect(exit).toEqual(
			Exit.fail(new Conflict({ message: "Entity schema default saved view already exists" })),
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
						id: "schema-id",
						name: input.name,
						icon: input.icon,
						slug: input.slug,
						isBuiltin: false,
						accentColor: input.accentColor,
						propertiesSchema: input.propertiesSchema,
					};
				}),
		}),
		makeTrackersRepository({
			linkEntitySchema: () => Effect.succeed("tracker-id"),
			getOwnedById: () =>
				Effect.succeed({
					icon: "star",
					slug: "custom",
					name: "Custom",
					id: "tracker-id",
					isBuiltin: false,
					description: null,
					accentColor: "#000000",
				}),
		}),
		makeSavedViewsRepository({ createDefaultViewForSchema: () => Effect.void }),
	);

	return Effect.gen(function* () {
		const service = yield* EntitySchemasService;
		const schema = yield* service.create(user, {
			icon: "rocket",
			name: " My Cool Schema ",
			trackerId: "tracker-id",
			accentColor: "#FF5733",
			propertiesSchema: {
				fields: { name: { type: "string", label: "Name", description: "Name" } },
			},
		});

		expect(createdSlug).toBe("my-cool-schema");
		expect(schema.slug).toBe("my-cool-schema");
	}).pipe(Effect.provide(layer));
});
