import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "../../lib/auth";
import { CurrentDb, DbService, TransactionRunner, type DbExecutor } from "../../lib/db";
import { BadRequest, NotFound } from "../../lib/errors";
import { TrackersRepository } from "./repository";
import { TrackersService, TrackersServiceLive } from "./service";

const user = {
	id: "user-id",
	name: "Test User",
	email: "user@example.com",
} satisfies CurrentUserValue;

const dummyDbLayer = Layer.succeed(DbService, {
	pool: null as never,
	db: null as never,
} satisfies DbService["Type"]);

const transactionLayer = Layer.succeed(
	TransactionRunner,
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, CurrentDb>> =>
		Effect.provideService(effect, CurrentDb, null as unknown as DbExecutor),
);

it.effect("normalizes tracker slugs before creating custom trackers", () => {
	let createdSlug = "";

	const layer = TrackersServiceLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				dummyDbLayer,
				transactionLayer,
				Layer.mock(TrackersRepository, {
					listByUser: () => Effect.succeed([]),
					findBySlug: () => Effect.succeed(null),
					updateOwned: () => Effect.succeed(null),
					getOwnedById: () => Effect.succeed(null),
					countOwnedByIds: () => Effect.succeed(0),
					listIdsInOrder: () => Effect.succeed([]),
					persistOrder: (_userId, trackerIds) => Effect.succeed(trackerIds),
					create: (_userId, input) =>
						Effect.sync(() => {
							createdSlug = input.slug;
							return {
								config: {},
								sortOrder: 0,
								id: "tracker-id",
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
			),
		),
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
	const layer = TrackersServiceLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				dummyDbLayer,
				transactionLayer,
				Layer.mock(TrackersRepository, {
					create: () => Effect.die("unused"),
					listByUser: () => Effect.succeed([]),
					findBySlug: () => Effect.succeed(null),
					updateOwned: () => Effect.succeed(null),
					countOwnedByIds: () => Effect.succeed(0),
					listIdsInOrder: () => Effect.succeed([]),
					getOwnedById: () => Effect.succeed(null),
					persistOrder: (_userId, trackerIds) => Effect.succeed(trackerIds),
				}),
			),
		),
	);

	return Effect.gen(function* () {
		const service = yield* TrackersService;
		const exit = yield* Effect.exit(service.update(user, "tracker-id", { isDisabled: false }));

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Tracker not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("reorders requested trackers and appends the remaining ids", () => {
	let persistedIds: ReadonlyArray<string> = [];

	const layer = TrackersServiceLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				dummyDbLayer,
				transactionLayer,
				Layer.mock(TrackersRepository, {
					create: () => Effect.die("unused"),
					listByUser: () => Effect.succeed([]),
					findBySlug: () => Effect.succeed(null),
					updateOwned: () => Effect.succeed(null),
					getOwnedById: () => Effect.succeed(null),
					countOwnedByIds: () => Effect.succeed(2),
					listIdsInOrder: () => Effect.succeed(["tracker-a", "tracker-b", "tracker-c"]),
					persistOrder: (_userId, trackerIds) =>
						Effect.sync(() => {
							persistedIds = trackerIds;
							return trackerIds;
						}),
				}),
			),
		),
	);

	return Effect.gen(function* () {
		const service = yield* TrackersService;
		const reordered = yield* service.reorder(user, { trackerIds: ["tracker-c", "tracker-a"] });

		expect(reordered).toEqual({ trackerIds: ["tracker-c", "tracker-a", "tracker-b"] });
		expect(persistedIds).toEqual(["tracker-c", "tracker-a", "tracker-b"]);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects reorder requests containing unknown tracker ids", () => {
	const layer = TrackersServiceLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				dummyDbLayer,
				transactionLayer,
				Layer.mock(TrackersRepository, {
					create: () => Effect.die("unused"),
					listByUser: () => Effect.succeed([]),
					findBySlug: () => Effect.succeed(null),
					updateOwned: () => Effect.succeed(null),
					getOwnedById: () => Effect.succeed(null),
					countOwnedByIds: () => Effect.succeed(1),
					listIdsInOrder: () => Effect.succeed([]),
					persistOrder: (_userId, trackerIds) => Effect.succeed(trackerIds),
				}),
			),
		),
	);

	return Effect.gen(function* () {
		const service = yield* TrackersService;
		const exit = yield* Effect.exit(
			service.reorder(user, { trackerIds: ["tracker-a", "tracker-b"] }),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Tracker ids contain unknown trackers" })),
		);
	}).pipe(Effect.provide(layer));
});
