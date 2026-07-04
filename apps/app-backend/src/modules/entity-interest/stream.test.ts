import { describe, expect, it } from "@effect/vitest";
import { UserId } from "@ryot/contract/schema/brands";
import { Deferred, Effect, Fiber, Stream } from "effect";

import type { StreamEnqueue, StreamRegistry } from "./registry";
import { events } from "./stream";

const streamId = "stream-1";
const userId = UserId.make("user-1");

const makeRegistry = (
	added: string[],
	removed: string[],
	registered?: Deferred.Deferred<void>,
): typeof StreamRegistry.Service => ({
	add: (id: string, _userId: UserId, _enqueue: StreamEnqueue) => {
		added.push(id);
		if (registered) {
			Deferred.doneUnsafe(registered, Effect.void);
		}
	},
	remove: (id: string) => {
		removed.push(id);
	},
	setInterestIfOwner: () => Effect.void,
	hasInterest: () => false,
});

const decode = (frames: ReadonlyArray<Uint8Array>) =>
	frames.map((bytes) => new TextDecoder().decode(bytes)).join("");

describe("interest event stream", () => {
	it.effect("registers the stream and emits a connected frame on subscribe", () =>
		Effect.gen(function* () {
			const added: string[] = [];
			const removed: string[] = [];
			const registry = makeRegistry(added, removed);

			const frames = yield* events(streamId, userId, registry).pipe(
				Stream.take(1),
				Stream.runCollect,
			);

			expect(added).toEqual([streamId]);
			expect(decode(frames)).toContain("event: connected");
			expect(decode(frames)).toContain(`"streamId":"${streamId}"`);
		}),
	);

	it.effect("removes the stream from the registry when the connection is interrupted", () =>
		Effect.gen(function* () {
			const added: string[] = [];
			const removed: string[] = [];
			const registered = yield* Deferred.make<void>();
			const registry = makeRegistry(added, removed, registered);

			const fiber = yield* Stream.merge(
				events(streamId, userId, registry),
				Stream.fromEffect(Effect.never),
			).pipe(Stream.runDrain, Effect.forkChild);

			yield* Deferred.await(registered);
			yield* Fiber.interrupt(fiber);

			expect(added).toEqual([streamId]);
			expect(removed).toEqual([streamId]);
		}),
	);
});
