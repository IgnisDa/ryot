import { expect, it } from "@effect/vitest";
import { encodeEntityUpdatedMessage } from "@ryot/contract/modules/entity-interest/messages";
import { EntityId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import Redis from "ioredis";

import { RedisService } from "#lib/infrastructure/redis";
import { makeRedisService } from "#lib/test-utils/effect";

import { LocalStreamConnections } from "./connections";
import { EntityInterestProgression } from "./progression";
import { EntityInterestStore } from "./store";
import { EntityInterestSubscriber } from "./subscriber";

const subscriber = Object.assign(Object.create(Redis.prototype), {
	on: () => subscriber,
	removeAllListeners: () => subscriber,
	quit: () => Promise.resolve("OK"),
	subscribe: () => Promise.resolve(1),
}) satisfies Redis;

const client = Object.assign(Object.create(Redis.prototype), {
	duplicate: () => subscriber,
}) satisfies Redis;

it.effect("routes valid messages and ignores malformed data", () => {
	const lookedUp: string[] = [];
	const progressed: string[] = [];
	const dependencies = Layer.mergeAll(
		LocalStreamConnections.layer,
		Layer.succeed(RedisService, makeRedisService({ client })),
		Layer.mock(EntityInterestProgression)({
			populated: (entityId) => Effect.sync(() => progressed.push(entityId)),
		}),
		Layer.mock(EntityInterestStore)({
			listInterestedStreams: (entityId) =>
				Effect.sync(() => {
					lookedUp.push(entityId);
					return ["stream-1", "remote-stream"];
				}),
		}),
	);

	return Effect.gen(function* () {
		const connections = yield* LocalStreamConnections;
		const interestSubscriber = yield* EntityInterestSubscriber;
		const frames: unknown[] = [];
		yield* connections.add("stream-1", (frame) => frames.push(frame));

		yield* interestSubscriber.dispatch("not-json");
		yield* interestSubscriber.dispatch(
			encodeEntityUpdatedMessage(EntityId.make("entity-1"), "translated"),
		);
		yield* interestSubscriber.dispatch(
			encodeEntityUpdatedMessage(EntityId.make("entity-2"), "populated"),
		);

		expect(lookedUp).toEqual(["entity-1", "entity-2"]);
		expect(progressed).toEqual(["entity-2"]);
		expect(frames).toEqual([
			{ entityId: "entity-1", reason: "translated" },
			{ entityId: "entity-2", reason: "populated" },
		]);
	}).pipe(Effect.provide(Layer.provideMerge(EntityInterestSubscriber.layer, dependencies)));
});

it.effect("bounds progression retries and absorbs the final failure", () => {
	let attempts = 0;
	const markedPending: unknown[] = [];
	const dependencies = Layer.mergeAll(
		LocalStreamConnections.layer,
		Layer.succeed(RedisService, makeRedisService({ client })),
		Layer.mock(EntityInterestStore)({
			listInterestedStreams: () => Effect.succeed(["stream-1", "stale-stream"]),
			markPending: (input) => Effect.sync(() => markedPending.push(input)),
		}),
		Layer.mock(EntityInterestProgression)({
			populated: () =>
				Effect.sync(() => {
					attempts += 1;
				}).pipe(Effect.andThen(Effect.die("progression failed"))),
		}),
	);

	return Effect.gen(function* () {
		const interestSubscriber = yield* EntityInterestSubscriber;
		yield* interestSubscriber.dispatch(
			encodeEntityUpdatedMessage(EntityId.make("entity-1"), "populated"),
		);

		expect(attempts).toBe(3);
		expect(markedPending).toEqual([
			{ entityId: "entity-1", streamIds: ["stream-1", "stale-stream"] },
		]);
	}).pipe(Effect.provide(Layer.provideMerge(EntityInterestSubscriber.layer, dependencies)));
});
