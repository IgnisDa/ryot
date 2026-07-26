import { expect, it } from "@effect/vitest";
import { NotFound } from "@ryot/contract/errors";
import { Effect } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";

import { LocalStreamConnections, type LocalStreamEnqueue } from "./connections";

it.effect("routes frames only to a connected local stream", () =>
	Effect.gen(function* () {
		const connections = yield* LocalStreamConnections;
		const frames: unknown[] = [];
		const frame = { entityId: "entity-1", reason: "populated" } as const;
		const enqueue: LocalStreamEnqueue = (received) => frames.push(received);

		yield* connections.add("stream-1", enqueue);
		yield* connections.enqueue("stream-1", frame);
		yield* connections.remove("stream-1", enqueue);
		yield* connections.enqueue("stream-1", frame);

		expect(frames).toEqual([frame]);
	}).pipe(Effect.provide(LocalStreamConnections.layer)),
);

it.effect("rejects a duplicate local claim and preserves the original callback", () =>
	Effect.gen(function* () {
		const connections = yield* LocalStreamConnections;
		const firstFrames: unknown[] = [];
		const secondFrames: unknown[] = [];
		const frame = { entityId: "entity-1", reason: "populated" } as const;
		const first: LocalStreamEnqueue = (received) => firstFrames.push(received);
		const second: LocalStreamEnqueue = (received) => secondFrames.push(received);

		yield* connections.add("stream-1", first);
		const duplicate = yield* Effect.exit(connections.add("stream-1", second));
		yield* connections.enqueue("stream-1", frame);

		assertExitFails(duplicate, new NotFound({ message: "Unknown stream" }));
		expect(firstFrames).toEqual([frame]);
		expect(secondFrames).toEqual([]);
	}).pipe(Effect.provide(LocalStreamConnections.layer)),
);

const first: LocalStreamEnqueue = () => undefined;

it.effect("does not remove a replacement connection from a stale release", () =>
	Effect.gen(function* () {
		const connections = yield* LocalStreamConnections;
		const frames: unknown[] = [];
		const frame = { entityId: "entity-1", reason: "populated" } as const;
		const second: LocalStreamEnqueue = (received) => frames.push(received);

		yield* connections.add("stream-1", first);
		yield* connections.remove("stream-1", first);
		yield* connections.add("stream-1", second);
		yield* connections.remove("stream-1", first);
		yield* connections.enqueue("stream-1", frame);

		expect(frames).toEqual([frame]);
	}).pipe(Effect.provide(LocalStreamConnections.layer)),
);
