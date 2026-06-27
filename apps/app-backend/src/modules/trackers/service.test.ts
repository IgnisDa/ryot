import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, Conflict, NotFound } from "@ryot/contract/errors";
import { EntitySchemaId, TrackerId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer, transactionLayer } from "#lib/test-utils/effect";

import { TrackersRepository } from "./repository";
import { TrackersService } from "./service";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const mockTrackersRepository = Layer.mock(TrackersRepository);

const makeTrackersRepository = (overrides: MockOverrides<typeof mockTrackersRepository> = {}) =>
	mockTrackersRepository({
		...overrides,
		_tag: "TrackersRepository",
	});

const makeServiceLayer = (repository: ReturnType<typeof makeTrackersRepository>) =>
	TrackersService.Default.pipe(
		Layer.provide(Layer.mergeAll(dbRunnerLayer, transactionLayer, repository)),
	);

it.effect("normalizes tracker slugs before creating custom trackers", () => {
	let createdSlug = "";

	const layer = makeServiceLayer(
		makeTrackersRepository({
			findBySlug: () => Effect.succeed(null),
			create: (_userId, input) =>
				Effect.sync(() => {
					createdSlug = input.slug;
					return {
						config: {},
						sortOrder: 0,
						id: TrackerId.make("tracker-id"),
						slug: input.slug,
						name: input.name,
						icon: input.icon,
						isBuiltin: false,
						isDisabled: false,
						accentColor: input.accentColor,
						description: input.description ?? null,
					};
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* TrackersService;
		const tracker = yield* service.create(user, {
			icon: "rocket",
			accentColor: "#FF5733",
			name: " My Cool Tracker ",
		});

		expect(createdSlug).toBe("my-cool-tracker");
		expect(tracker.slug).toBe("my-cool-tracker");
	}).pipe(Effect.provide(layer));
});

it.effect("forwards built-in metadata through the canonical create method", () => {
	let createdAsBuiltin = false;

	const layer = makeServiceLayer(
		makeTrackersRepository({
			findBySlug: () => Effect.succeed(null),
			create: (_userId, input) =>
				Effect.sync(() => {
					createdAsBuiltin = input.isBuiltin === true;
					return {
						config: {},
						sortOrder: 0,
						id: TrackerId.make("tracker-id"),
						slug: input.slug,
						name: input.name,
						icon: input.icon,
						isBuiltin: true,
						isDisabled: false,
						accentColor: input.accentColor,
						description: input.description ?? null,
					};
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* TrackersService;
		const tracker = yield* service.create(user, {
			icon: "film",
			name: "Media",
			slug: "media",
			accentColor: "#5B7FFF",
			description: "Built-in media tracker",
			isBuiltin: true,
		});

		expect(createdAsBuiltin).toBe(true);
		expect(tracker.isBuiltin).toBe(true);
	}).pipe(Effect.provide(layer));
});

it.effect("reports a conflict when a concurrent create wins the unique insert", () => {
	const layer = makeServiceLayer(
		makeTrackersRepository({
			findBySlug: () => Effect.succeed(null),
			create: () => Effect.succeed(null),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* TrackersService;
		const exit = yield* Effect.exit(
			service.create(user, {
				icon: "film",
				name: "Media",
				slug: "media",
				accentColor: "#5B7FFF",
			}),
		);

		expect(exit).toEqual(Exit.fail(new Conflict({ message: "Tracker slug already exists" })));
	}).pipe(Effect.provide(layer));
});

it.effect("delegates tracker-schema links through the repository", () => {
	let linked: { trackerId: TrackerId; entitySchemaId: EntitySchemaId } | undefined;
	const layer = makeServiceLayer(
		makeTrackersRepository({
			linkEntitySchema: (input) =>
				Effect.sync(() => {
					linked = input;
					return input.trackerId;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* TrackersService;
		const trackerId = TrackerId.make("tracker-id");
		const entitySchemaId = EntitySchemaId.make("schema-id");

		yield* service.linkEntitySchema({ trackerId, entitySchemaId });

		expect(linked).toEqual({ trackerId, entitySchemaId });
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when updating a tracker the user does not own", () => {
	const layer = makeServiceLayer(
		makeTrackersRepository({ getOwnedById: () => Effect.succeed(null) }),
	);

	return Effect.gen(function* () {
		const service = yield* TrackersService;
		const exit = yield* Effect.exit(
			service.update(user, TrackerId.make("tracker-id"), { isDisabled: false }),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Tracker not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("reorders requested trackers and appends the remaining ids", () => {
	const persistedOrder: Array<{ trackerId: string; sortOrder: number | undefined }> = [];
	const sortOrderById = new Map([
		["tracker-a", 0],
		["tracker-b", 1],
		["tracker-c", 2],
	]);

	const layer = makeServiceLayer(
		makeTrackersRepository({
			countOwnedByIds: () => Effect.succeed(2),
			listInOrder: () =>
				Effect.succeed(
					["tracker-a", "tracker-b", "tracker-c"].map((id) => ({
						config: {},
						icon: "rocket",
						name: id,
						slug: id,
						description: null,
						isBuiltin: false,
						isDisabled: false,
						accentColor: "#FF5733",
						id: TrackerId.make(id),
						sortOrder: sortOrderById.get(id) ?? 0,
					})),
				),
			getOwnedById: (_userId, trackerId) =>
				Effect.succeed({
					id: trackerId,
					slug: trackerId,
					name: trackerId,
					icon: "rocket",
					description: null,
					isBuiltin: false,
					accentColor: "#FF5733",
				}),
			updateOwned: (input) =>
				Effect.sync(() => {
					persistedOrder.push({ trackerId: input.trackerId, sortOrder: input.sortOrder });
					return {
						config: {},
						icon: input.icon,
						name: input.name,
						slug: input.slug,
						isBuiltin: false,
						isDisabled: input.isDisabled,
						id: input.trackerId,
						accentColor: input.accentColor,
						description: input.description,
						sortOrder: input.sortOrder ?? 0,
					};
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* TrackersService;
		const reordered = yield* service.reorder(user, {
			trackerIds: [TrackerId.make("tracker-c"), TrackerId.make("tracker-a")],
		});

		expect(reordered).toEqual({ trackerIds: ["tracker-c", "tracker-a", "tracker-b"] });
		expect(persistedOrder).toEqual([
			{ trackerId: "tracker-c", sortOrder: 0 },
			{ trackerId: "tracker-a", sortOrder: 1 },
			{ trackerId: "tracker-b", sortOrder: 2 },
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects reorder requests containing unknown tracker ids", () => {
	const layer = makeServiceLayer(
		makeTrackersRepository({ countOwnedByIds: () => Effect.succeed(1) }),
	);

	return Effect.gen(function* () {
		const service = yield* TrackersService;
		const exit = yield* Effect.exit(
			service.reorder(user, {
				trackerIds: [TrackerId.make("tracker-a"), TrackerId.make("tracker-b")],
			}),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Tracker ids contain unknown trackers" })),
		);
	}).pipe(Effect.provide(layer));
});
