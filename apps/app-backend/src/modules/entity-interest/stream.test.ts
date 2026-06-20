import { describe, expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { NotFound } from "@ryot/contract/errors";
import { UserId } from "@ryot/contract/schema/brands";
import { Deferred, Duration, Effect, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";

import { assertExitFails } from "#lib/test-utils/assertions";

import { LocalStreamConnections } from "./connections";
import type { EntityInterestStore } from "./store";
import { events } from "./stream";

const streamId = "stream-1";
const user = {
	name: "User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { isNsfw: false, language: "es", disableIntegrations: false },
} satisfies CurrentUserValue;

type Connections = Pick<typeof LocalStreamConnections.Service, "add" | "remove">;
type Store = Pick<typeof EntityInterestStore.Service, "closeStream" | "openStream" | "renewStream">;

const makeConnections = (activity: string[]): Connections => ({
	add: (id) => Effect.sync(() => activity.push(`add:${id}`)).pipe(Effect.asVoid),
	remove: (id) => Effect.sync(() => activity.push(`remove:${id}`)).pipe(Effect.asVoid),
});

const makeStore = (activity: string[], overrides: Partial<Store> = {}): Store => ({
	openStream: (input) =>
		Effect.sync(() =>
			activity.push(
				`open:${input.streamId}:${input.userId}:${input.preferredLanguage ?? "canonical"}`,
			),
		).pipe(Effect.as(undefined)),
	closeStream: (id) => Effect.sync(() => (activity.push(`close:${id}`), true)),
	renewStream: (id) => Effect.sync(() => (activity.push(`renew:${id}`), true)),
	...overrides,
});

const decode = (frames: ReadonlyArray<Uint8Array>) =>
	frames.map((bytes) => new TextDecoder().decode(bytes)).join("");

describe("interest event stream", () => {
	it.effect("claims local and Redis state before emitting connected", () =>
		Effect.gen(function* () {
			const activity: string[] = [];
			const frames = yield* events(
				streamId,
				user,
				makeConnections(activity),
				makeStore(activity),
			).pipe(Stream.take(1), Stream.runCollect);

			expect(activity.slice(0, 2)).toEqual(["add:stream-1", "open:stream-1:user-1:es"]);
			expect(decode(frames)).toContain("event: connected");
			expect(decode(frames)).toContain(`"streamId":"${streamId}"`);
		}),
	);

	it.effect("removes its local claim when Redis open fails", () =>
		Effect.gen(function* () {
			const activity: string[] = [];
			const connections = yield* LocalStreamConnections;
			const error = new NotFound({ message: "Unknown stream" });
			const frames: unknown[] = [];
			const frame = { entityId: "entity-1", reason: "populated" } as const;
			const store = makeStore(activity, {
				openStream: () =>
					Effect.sync(() => activity.push("open:failed")).pipe(Effect.andThen(Effect.fail(error))),
			});
			const exit = yield* Effect.exit(
				events(streamId, user, connections, store).pipe(Stream.runCollect),
			);
			yield* connections.add(streamId, (received) => frames.push(received));
			yield* connections.enqueue(streamId, frame);

			assertExitFails(exit, error);
			expect(activity).toEqual(["open:failed"]);
			expect(frames).toEqual([frame]);
		}).pipe(Effect.provide(LocalStreamConnections.layer)),
	);

	it.effect("renews Redis state every five minutes", () =>
		Effect.gen(function* () {
			const activity: string[] = [];
			const fiber = yield* events(
				streamId,
				user,
				makeConnections(activity),
				makeStore(activity),
			).pipe(Stream.runDrain, Effect.forkChild);
			yield* Effect.yieldNow;

			yield* TestClock.adjust(Duration.minutes(4));
			expect(activity.filter((item) => item.startsWith("renew:"))).toEqual([]);
			yield* TestClock.adjust(Duration.minutes(1));
			expect(activity.filter((item) => item.startsWith("renew:"))).toEqual(["renew:stream-1"]);

			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("terminates with NotFound when stream metadata is lost", () =>
		Effect.gen(function* () {
			const activity: string[] = [];
			const error = new NotFound({ message: "Unknown stream" });
			const fiber = yield* events(
				streamId,
				user,
				makeConnections(activity),
				makeStore(activity, {
					renewStream: (id) => Effect.sync(() => (activity.push(`renew:${id}`), false)),
				}),
			).pipe(Stream.runDrain, Effect.forkChild);
			yield* Effect.yieldNow;

			yield* TestClock.adjust(Duration.minutes(5));
			const exit = yield* Fiber.await(fiber);

			assertExitFails(exit, error);
			expect(activity).toEqual([
				"add:stream-1",
				"open:stream-1:user-1:es",
				"renew:stream-1",
				"remove:stream-1",
				"close:stream-1",
			]);
		}),
	);

	it.effect("removes local state before ignoring Redis close failure", () =>
		Effect.gen(function* () {
			const activity: string[] = [];
			const opened = yield* Deferred.make<void>();
			const store = makeStore(activity, {
				openStream: (input) =>
					Effect.sync(() => {
						activity.push(`open:${input.streamId}`);
						Deferred.doneUnsafe(opened, Effect.void);
					}).pipe(Effect.as(undefined)),
				closeStream: (id) =>
					Effect.sync(() => activity.push(`close:${id}`)).pipe(
						Effect.andThen(Effect.die("close failed")),
					),
			});
			const fiber = yield* events(streamId, user, makeConnections(activity), store).pipe(
				Stream.runDrain,
				Effect.forkChild,
			);

			yield* Deferred.await(opened);
			yield* Fiber.interrupt(fiber);

			expect(activity).toEqual([
				"add:stream-1",
				"open:stream-1",
				"remove:stream-1",
				"close:stream-1",
			]);
		}),
	);
});
