import { expect, layer } from "@effect/vitest";
import { encodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-watches/messages";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import Redis from "ioredis";

import { RedisService } from "#platform/redis";
import { databaseLayer, makeRedisService } from "#testing/effect";

import { LocalInterestSessions } from "./connections";
import { EntityWatchProgression } from "./progression";
import { EntityWatchStore } from "./store";
import { EntityWatchSubscriber } from "./subscriber";

const subscriber = Object.assign(Object.create(Redis.prototype), {
	on: () => subscriber,
	quit: () => Promise.resolve("OK"),
	subscribe: () => Promise.resolve(1),
	removeAllListeners: () => subscriber,
}) satisfies Redis;

const client = Object.assign(Object.create(Redis.prototype), {
	duplicate: () => subscriber,
}) satisfies Redis;

type MarkPendingInput = Parameters<EntityWatchStore["Service"]["markPending"]>[0];

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
	readonly sessionUsers?: Readonly<Record<string, string>>;
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
				Layer.mock(EntityWatchProgression)({
					populated: (entityId) =>
						Ref.update(progressed, (all) => [...all, entityId]).pipe(
							Effect.andThen(
								options.failProgression ? Effect.die("progression failed") : Effect.void,
							),
						),
				}),
				Layer.mock(EntityWatchStore)({
					markPending: (input) => Ref.update(markedPending, (all) => [...all, input]),
					listWatchingSessions: (entityId) =>
						Ref.update(lookedUp, (all) => [...all, entityId]).pipe(
							Effect.andThen(Ref.get(watching)),
							Effect.map((sessionIds) => [...sessionIds]),
						),
					getSessionMetadata: (sessionIds) =>
						Effect.succeed(
							sessionIds.flatMap((sessionId) => {
								const userIdValue = options.sessionUsers?.[sessionId];
								if (userIdValue === undefined) {
									return [];
								}
								const userId = UserId.make(userIdValue);
								return [
									{
										userId,
										sessionId,
										revision: 1,
										preferredLanguage: null,
										accountGeneration: { userId, token: "test-account-generation" },
									},
								];
							}),
						),
				}),
				Layer.succeed(FakeSubscriberDependencies, {
					lookedUp: Ref.get(lookedUp),
					progressed: Ref.get(progressed),
					markedPending: Ref.get(markedPending),
					watch: (sessionIds) => Ref.set(watching, sessionIds),
				}),
			);
			return Layer.provideMerge(EntityWatchSubscriber.layer, dependencies);
		}),
	);

layer(subscriberLayer({ watching: ["session-1", "remote-session"] }))((test) => {
	test.effect("routes valid messages and ignores malformed data", () =>
		Effect.gen(function* () {
			const sessions = yield* LocalInterestSessions;
			const interestSubscriber = yield* EntityWatchSubscriber;
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
				const interestSubscriber = yield* EntityWatchSubscriber;
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
			const interestSubscriber = yield* EntityWatchSubscriber;
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

layer(
	subscriberLayer({
		watching: ["owner-session", "other-session"],
		sessionUsers: { "owner-session": "owner", "other-session": "other" },
	}),
)((test) => {
	test.effect("routes scoped projection updates to the owning user's session", () =>
		Effect.gen(function* () {
			const sessions = yield* LocalInterestSessions;
			const interestSubscriber = yield* EntityWatchSubscriber;
			const ownerFrames: unknown[] = [];
			const otherFrames: unknown[] = [];
			yield* sessions.add("owner-session", (frame) => ownerFrames.push(frame));
			yield* sessions.add("other-session", (frame) => otherFrames.push(frame));

			yield* interestSubscriber.dispatch(
				encodeEntityUpdatedMessage(
					EntityId.make("global-entity"),
					"projection-updated",
					UserId.make("owner"),
				),
			);

			expect(ownerFrames).toEqual([
				{ type: "entity-updated", entityId: "global-entity", reason: "projection-updated" },
			]);
			expect(otherFrames).toEqual([]);
			expect(yield* (yield* FakeSubscriberDependencies).progressed).toEqual([]);
		}),
	);
});
