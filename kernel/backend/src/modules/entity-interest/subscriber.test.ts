import { expect, it } from "@effect/vitest";
import { encodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-interest/messages";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import Redis from "ioredis";

import { RedisService } from "#lib/infrastructure/redis";
import { databaseLayer, makeRedisService } from "#lib/test-utils/effect";

import { LocalInterestSessions } from "./connections";
import { EntityInterestProgression } from "./progression";
import { EntityInterestStore } from "./store";
import { EntityInterestSubscriber } from "./subscriber";

const subscriber = Object.assign(Object.create(Redis.prototype), {
	on: () => subscriber,
	quit: () => Promise.resolve("OK"),
	subscribe: () => Promise.resolve(1),
	removeAllListeners: () => subscriber,
}) satisfies Redis;

const client = Object.assign(Object.create(Redis.prototype), {
	duplicate: () => subscriber,
}) satisfies Redis;

it.effect("routes valid messages and ignores malformed data", () => {
	const lookedUp: string[] = [];
	const progressed: string[] = [];
	const dependencies = Layer.mergeAll(
		databaseLayer,
		LocalInterestSessions.layer,
		Layer.succeed(RedisService, makeRedisService({ client })),
		Layer.mock(EntityInterestProgression)({
			populated: (entityId) => Effect.sync(() => progressed.push(entityId)),
		}),
		Layer.mock(EntityInterestStore)({
			listWatchingSessions: (entityId) =>
				Effect.sync(() => {
					lookedUp.push(entityId);
					return ["session-1", "remote-session"];
				}),
		}),
	);

	return Effect.gen(function* () {
		const sessions = yield* LocalInterestSessions;
		const interestSubscriber = yield* EntityInterestSubscriber;
		const frames: unknown[] = [];
		yield* sessions.add("session-1", (frame) => frames.push(frame));

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
			{ entityId: "entity-1", reason: "translated", type: "entity-updated" },
			{ reason: "populated", entityId: "entity-2", type: "entity-updated" },
		]);
	}).pipe(Effect.provide(Layer.provideMerge(EntityInterestSubscriber.layer, dependencies)));
});

it.effect("bounds progression retries and absorbs the final failure", () => {
	let attempts = 0;
	const markedPending: unknown[] = [];
	const dependencies = Layer.mergeAll(
		databaseLayer,
		LocalInterestSessions.layer,
		Layer.succeed(RedisService, makeRedisService({ client })),
		Layer.mock(EntityInterestStore)({
			markPending: (input) => Effect.sync(() => markedPending.push(input)),
			listWatchingSessions: () => Effect.succeed(["session-1", "stale-session"]),
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
			{ entityId: "entity-1", sessionIds: ["session-1", "stale-session"] },
		]);
	}).pipe(Effect.provide(Layer.provideMerge(EntityInterestSubscriber.layer, dependencies)));
});

it.effect("delivers a private publication only after watching membership is confirmed", () => {
	let watching = false;
	const dependencies = Layer.mergeAll(
		databaseLayer,
		LocalInterestSessions.layer,
		Layer.succeed(RedisService, makeRedisService({ client })),
		Layer.mock(EntityInterestProgression)({}),
		Layer.mock(EntityInterestStore)({
			listWatchingSessions: () => Effect.succeed(watching ? ["session-1"] : []),
		}),
	);

	return Effect.gen(function* () {
		const sessions = yield* LocalInterestSessions;
		const interestSubscriber = yield* EntityInterestSubscriber;
		const frames: unknown[] = [];
		yield* sessions.add("session-1", (frame) => frames.push(frame));

		yield* interestSubscriber.dispatch(
			encodeEntityUpdatedMessage(EntityId.make("private-entity"), "translated"),
		);
		expect(frames).toEqual([]);

		watching = true;
		yield* interestSubscriber.dispatch(
			encodeEntityUpdatedMessage(EntityId.make("private-entity"), "translated"),
		);
		expect(frames).toEqual([
			{ reason: "translated", type: "entity-updated", entityId: "private-entity" },
		]);
	}).pipe(Effect.provide(Layer.provideMerge(EntityInterestSubscriber.layer, dependencies)));
});
