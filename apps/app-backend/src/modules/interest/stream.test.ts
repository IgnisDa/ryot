import { describe, expect, it } from "@effect/vitest";
import { Chunk, Deferred, Effect, Fiber, Stream } from "effect";

import { UserId } from "#lib/schema/brands";

import type { StreamEnqueue, StreamRegistry } from "./registry";
import { events } from "./stream";

const streamId = "stream-1";
const userId = UserId.make("user-1");

// A stand-in registry that records add/remove calls (and optionally signals when `add` runs), so the
// test can assert the stream's acquire/release wiring without a real Redis-backed StreamRegistry.
const makeRegistry = (
	added: string[],
	removed: string[],
	registered?: Deferred.Deferred<void>,
): typeof StreamRegistry.Service => ({
	_tag: "StreamRegistry",
	add: (id: string, _userId: UserId, _enqueue: StreamEnqueue) => {
		added.push(id);
		if (registered) {
			Deferred.unsafeDone(registered, Effect.void);
		}
	},
	remove: (id: string) => {
		removed.push(id);
	},
	setInterestIfOwner: () => Effect.void,
	hasInterest: () => false,
});

const decode = (frames: Chunk.Chunk<Uint8Array>): string =>
	Chunk.toReadonlyArray(frames)
		.map((bytes) => new TextDecoder().decode(bytes))
		.join("");

describe("interest event stream", () => {
	it.effect("registers the stream and emits a connected frame on subscribe", () =>
		Effect.gen(function* () {
			const added: string[] = [];
			const removed: string[] = [];
			const registry = makeRegistry(added, removed);

			// take(1) pulls the `connected` frame emitted during acquire, then completes — which closes
			// the stream scope and runs the release.
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

			// Merge with a never-ending stream (as the real response merges with the heartbeat), so the
			// fiber stays open like a live SSE connection and interrupting it must tear down the events
			// branch's scope — the mechanism stream.ts relies on for cleanup on client disconnect.
			const fiber = yield* Stream.merge(
				events(streamId, userId, registry),
				Stream.fromEffect(Effect.never),
			).pipe(Stream.runDrain, Effect.fork);

			// Wait until the stream has registered, then interrupt it the way a client disconnect does.
			yield* Deferred.await(registered);
			yield* Fiber.interrupt(fiber);

			expect(added).toEqual([streamId]);
			expect(removed).toEqual([streamId]);
		}),
	);
});
