import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { BadRequest, NotFound } from "#lib/errors";
import { TrackerId, UserId } from "#lib/schema/brands";
import type { MockOverrides } from "#lib/test-support/effect";
import { dbRunnerLayer, transactionLayer } from "#lib/test-support/effect";

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
	let persistedIds: ReadonlyArray<string> = [];

	const layer = makeServiceLayer(
		makeTrackersRepository({
			countOwnedByIds: () => Effect.succeed(2),
			listIdsInOrder: () =>
				Effect.succeed([
					TrackerId.make("tracker-a"),
					TrackerId.make("tracker-b"),
					TrackerId.make("tracker-c"),
				]),
			persistOrder: (_userId, trackerIds) =>
				Effect.sync(() => {
					persistedIds = trackerIds;
					return trackerIds;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* TrackersService;
		const reordered = yield* service.reorder(user, {
			trackerIds: [TrackerId.make("tracker-c"), TrackerId.make("tracker-a")],
		});

		expect(reordered).toEqual({ trackerIds: ["tracker-c", "tracker-a", "tracker-b"] });
		expect(persistedIds).toEqual(["tracker-c", "tracker-a", "tracker-b"]);
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
