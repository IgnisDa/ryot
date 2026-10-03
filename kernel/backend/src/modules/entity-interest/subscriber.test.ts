import { expect, layer } from "@effect/vitest";
import { encodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-interest/messages";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
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

type MarkPendingInput = Parameters<EntityInterestStore["Service"]["markPending"]>[0];

class FakeSubscriberDependencies extends Context.Service<
	FakeSubscriberDependencies,
	{
		readonly lookedUp: Effect.Effect<ReadonlyArray<string>>;
		readonly progressed: Effect.Effect<ReadonlyArray<string>>;
		readonly markedPending: Effect.Effect<ReadonlyArray<MarkPendingInput>>;
		readonly watch: (sessionIds: ReadonlyArray<string>) => Effect.Effect<void>;
	}
>()("test/FakeSubscriberDependencies") {}

const subscriberLayer = (options: {
	readonly watching: ReadonlyArray<string>;
	readonly failProgression?: boolean;
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const watching = yield* Ref.make(options.watching);
			const lookedUp = yield* Ref.make<ReadonlyArray<string>>([]);
			const progressed = yield* Ref.make<ReadonlyArray<string>>([]);
			const markedPending = yield* Ref.make<ReadonlyArray<MarkPendingInput>>([]);
			const dependencies = Layer.mergeAll(
				databaseLayer,
				LocalInterestSessions.layer,
				Layer.succeed(RedisService, makeRedisService({ client })),
				Layer.mock(EntityInterestProgression)({
					populated: (entityId) =>
						Ref.update(progressed, (all) => [...all, entityId]).pipe(
							Effect.andThen(
								options.failProgression ? Effect.die("progression failed") : Effect.void,
							),
						),
				}),
				Layer.mock(EntityInterestStore)({
					markPending: (input) => Ref.update(markedPending, (all) => [...all, input]),
					listWatchingSessions: (entityId) =>
						Ref.update(lookedUp, (all) => [...all, entityId]).pipe(
							Effect.andThen(Ref.get(watching)),
							Effect.map((sessionIds) => [...sessionIds]),
						),
				}),
				Layer.succeed(FakeSubscriberDependencies, {
					lookedUp: Ref.get(lookedUp),
					progressed: Ref.get(progressed),
					markedPending: Ref.get(markedPending),
					watch: (sessionIds) => Ref.set(watching, sessionIds),
				}),
			);
			return Layer.provideMerge(EntityInterestSubscriber.layer, dependencies);
		}),
	);

layer(subscriberLayer({ watching: ["session-1", "remote-session"] }))((test) => {
	test.effect("routes valid messages and ignores malformed data", () =>
		Effect.gen(function* () {
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

			const fake = yield* FakeSubscriberDependencies;
			expect(yield* fake.lookedUp).toEqual(["entity-1", "entity-2"]);
			expect(yield* fake.progressed).toEqual(["entity-2"]);
			expect(frames).toEqual([
				{ entityId: "entity-1", reason: "translated", type: "entity-updated" },
				{ reason: "populated", entityId: "entity-2", type: "entity-updated" },
			]);
		}),
	);
});

layer(subscriberLayer({ failProgression: true, watching: ["session-1", "stale-session"] }))(
	(test) => {
		test.effect("bounds progression retries and absorbs the final failure", () =>
			Effect.gen(function* () {
				const interestSubscriber = yield* EntityInterestSubscriber;
				yield* interestSubscriber.dispatch(
					encodeEntityUpdatedMessage(EntityId.make("entity-1"), "populated"),
				);

				const fake = yield* FakeSubscriberDependencies;
				expect((yield* fake.progressed).length).toBe(3);
				expect(yield* fake.markedPending).toEqual([
					{ entityId: "entity-1", sessionIds: ["session-1", "stale-session"] },
				]);
			}),
		);
	},
);

layer(subscriberLayer({ watching: [] }))((test) => {
	test.effect("delivers a private publication only after watching membership is confirmed", () =>
		Effect.gen(function* () {
			const sessions = yield* LocalInterestSessions;
			const interestSubscriber = yield* EntityInterestSubscriber;
			const frames: unknown[] = [];
			yield* sessions.add("session-1", (frame) => frames.push(frame));

			yield* interestSubscriber.dispatch(
				encodeEntityUpdatedMessage(EntityId.make("private-entity"), "translated"),
			);
			expect(frames).toEqual([]);

			yield* (yield* FakeSubscriberDependencies).watch(["session-1"]);
			yield* interestSubscriber.dispatch(
				encodeEntityUpdatedMessage(EntityId.make("private-entity"), "translated"),
			);
			expect(frames).toEqual([
				{ reason: "translated", type: "entity-updated", entityId: "private-entity" },
			]);
		}),
	);
});
