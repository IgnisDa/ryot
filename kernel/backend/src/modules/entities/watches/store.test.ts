import { expect, it, layer } from "@effect/vitest";
import { MAX_FOREGROUND_ENTITY_IDS } from "@ryot-app/contract/modules/entity-watches/messages";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { describe } from "vitest";

import {
	ENTITY_WATCH_PROGRESSION_LEASE_SECONDS,
	ENTITY_WATCH_SESSION_RENEWAL_INTERVAL_SECONDS,
	ENTITY_WATCH_SESSION_TTL_SECONDS,
	redisKeys,
	RedisService,
} from "#platform/redis";
import { testRedisServiceLayer } from "#testing/redis";

import { EntityWatchStore } from "./store";

describe("entity interest Redis keys", () => {
	it("uses the exact session and reverse-index keys", () => {
		expect(redisKeys.entityWatchSession("session-1")).toBe("ryot:entity-watches:session:session-1");
		expect(redisKeys.entityWatchSessionEntities("session-1")).toBe(
			"ryot:entity-watches:session:session-1:entities",
		);
		expect(redisKeys.entityWatchSessions("entity-1")).toBe(
			"ryot:entity-watches:entity:entity-1:sessions",
		);
		expect(redisKeys.entityWatchProgressionLease("entity-1")).toBe(
			"ryot:entity-watches:progress:entity-1",
		);
	});

	it("uses the session timing bounds", () => {
		expect(ENTITY_WATCH_SESSION_TTL_SECONDS).toBe(15 * 60);
		expect(ENTITY_WATCH_SESSION_RENEWAL_INTERVAL_SECONDS).toBe(5 * 60);
		expect(ENTITY_WATCH_PROGRESSION_LEASE_SECONDS).toBe(30);
	});
});

const sessionKeysOf = (sessionId: string, entityIds: readonly string[]) => [
	redisKeys.entityWatchSession(sessionId),
	redisKeys.entityWatchSessionEntities(sessionId),
	...entityIds.map((entityId) => redisKeys.entityWatchSessions(entityId)),
];

const ids = (prefix: string, count: number) =>
	Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

const withSession = <A, E, R>(
	entityIds: readonly string[],
	body: (input: {
		readonly sessionId: string;
		readonly store: EntityWatchStore["Service"];
		readonly tokens: Effect.Effect<Readonly<Record<string, string>>>;
	}) => Effect.Effect<A, E, R>,
) =>
	Effect.gen(function* () {
		const sessionId = `store-test-${crypto.randomUUID()}`;
		const store = yield* EntityWatchStore;
		const redis = yield* RedisService;
		const clear = Effect.promise(() => redis.client.del(...sessionKeysOf(sessionId, entityIds)));
		yield* clear;
		yield* Effect.addFinalizer(() => clear);
		yield* store.openSession({
			sessionId,
			preferredLanguage: null,
			userId: UserId.make("store-user"),
			accountGeneration: { token: "test-account-generation", userId: UserId.make("store-user") },
		});
		const tokens = Effect.promise(() =>
			redis.client.hgetall(redisKeys.entityWatchSessionEntities(sessionId)),
		);
		return yield* body({ store, tokens, sessionId });
	}).pipe(Effect.scoped);

const storeLayer = EntityWatchStore.layer.pipe(Layer.provideMerge(testRedisServiceLayer));

layer(storeLayer, { excludeTestServices: true })((test) => {
	test.effect("stores priority in membership tokens and returns it with pending interest", () =>
		withSession(["a", "b"], ({ store, tokens, sessionId }) =>
			Effect.gen(function* () {
				const applied = yield* store.replaceInterest({
					sessionId,
					revision: 1,
					foregroundIds: ["b"],
					entityIds: ["a", "b"],
				});
				expect(applied).toEqual({
					revision: 1,
					status: "applied",
					pending: expect.arrayContaining([
						{ revision: 1, entityId: "a", priority: "visible" },
						{ revision: 1, entityId: "b", priority: "foreground" },
					]),
				});
				expect(yield* tokens).toEqual({ a: "pending:1:v", b: "pending:1:f" });
				expect(
					yield* store.markReconciled({
						sessionId,
						pending: [
							{ revision: 1, entityId: "a", priority: "foreground" },
							{ revision: 1, entityId: "b", priority: "foreground" },
						],
					}),
				).toEqual(["b"]);
				expect(yield* tokens).toEqual({ b: "watching:f", a: "pending:1:v" });
				expect(
					yield* store.removePending({
						sessionId,
						pending: [{ revision: 1, entityId: "a", priority: "visible" }],
					}),
				).toEqual(["a"]);
				expect(yield* tokens).toEqual({ b: "watching:f" });
			}),
		),
	);

	test.effect("re-pends a promotion and demotes a watching entity without reconciliation", () =>
		withSession(["a", "b"], ({ store, tokens, sessionId }) =>
			Effect.gen(function* () {
				yield* store.replaceInterest({
					sessionId,
					revision: 1,
					foregroundIds: ["b"],
					entityIds: ["a", "b"],
				});
				yield* store.markReconciled({
					sessionId,
					pending: [
						{ revision: 1, entityId: "a", priority: "visible" },
						{ revision: 1, entityId: "b", priority: "foreground" },
					],
				});

				const updated = yield* store.updateInterest({
					add: [],
					sessionId,
					remove: [],
					revision: 2,
					addForeground: ["a"],
					removeForeground: ["b"],
				});

				expect(updated).toEqual({
					revision: 2,
					status: "applied",
					pending: [{ revision: 2, entityId: "a", priority: "foreground" }],
				});
				expect(yield* tokens).toEqual({ b: "watching:v", a: "pending:2:f" });
				const replaced = yield* store.replaceInterest({
					sessionId,
					revision: 3,
					foregroundIds: ["b"],
					entityIds: ["a", "b"],
				});
				expect(replaced).toEqual({
					revision: 3,
					status: "applied",
					pending: expect.arrayContaining([
						{ revision: 3, entityId: "a", priority: "visible" },
						{ revision: 3, entityId: "b", priority: "foreground" },
					]),
				});
			}),
		),
	);

	test.effect("bumps the revision when a promotion is demoted before reconciliation", () =>
		withSession(["a"], ({ store, tokens, sessionId }) =>
			Effect.gen(function* () {
				yield* store.replaceInterest({
					sessionId,
					revision: 1,
					entityIds: ["a"],
					foregroundIds: [],
				});
				const update = (revision: number, change: "addForeground" | "removeForeground") =>
					store.updateInterest({
						add: [],
						revision,
						sessionId,
						remove: [],
						addForeground: change === "addForeground" ? ["a"] : [],
						removeForeground: change === "removeForeground" ? ["a"] : [],
					});
				yield* update(2, "addForeground");
				expect(yield* update(3, "removeForeground")).toEqual({
					revision: 3,
					status: "applied",
					pending: [{ revision: 3, entityId: "a", priority: "visible" }],
				});
				expect(
					yield* store.markReconciled({
						sessionId,
						pending: [
							{ revision: 1, entityId: "a", priority: "visible" },
							{ revision: 2, entityId: "a", priority: "foreground" },
						],
					}),
				).toEqual([]);
				expect(
					yield* store.markReconciled({
						sessionId,
						pending: [{ revision: 3, entityId: "a", priority: "visible" }],
					}),
				).toEqual(["a"]);
				expect(yield* tokens).toEqual({ a: "watching:v" });
			}),
		),
	);

	test.effect("keeps priority when marking pending and lists only watching sessions", () =>
		withSession(["a", "b"], ({ store, tokens, sessionId }) =>
			Effect.gen(function* () {
				yield* store.replaceInterest({
					sessionId,
					revision: 1,
					foregroundIds: ["a"],
					entityIds: ["a", "b"],
				});
				expect(yield* store.listWatchingSessions("a")).toEqual([]);
				yield* store.markReconciled({
					sessionId,
					pending: [
						{ revision: 1, entityId: "a", priority: "foreground" },
						{ revision: 1, entityId: "b", priority: "visible" },
					],
				});
				expect(yield* store.listWatchingSessions("a")).toEqual([sessionId]);
				expect(yield* store.listWatchingSessions("b")).toEqual([sessionId]);

				yield* store.markPending({ entityId: "a", sessionIds: [sessionId] });
				yield* store.markPending({ entityId: "b", sessionIds: [sessionId] });

				expect(yield* tokens).toEqual({ a: "pending:1:f", b: "pending:1:v" });
				expect(yield* store.listWatchingSessions("a")).toEqual([]);
			}),
		),
	);

	test.effect("enforces the foreground cap and foreground membership", () =>
		withSession(ids("cap", MAX_FOREGROUND_ENTITY_IDS + 2), ({ store, tokens, sessionId }) =>
			Effect.gen(function* () {
				const members = ids("cap", MAX_FOREGROUND_ENTITY_IDS + 2);
				expect(
					yield* store.replaceInterest({
						sessionId,
						revision: 1,
						entityIds: members,
						foregroundIds: members.slice(0, MAX_FOREGROUND_ENTITY_IDS + 1),
					}),
				).toEqual({ status: "limit-exceeded" });
				expect(
					yield* store.replaceInterest({
						sessionId,
						revision: 1,
						entityIds: ["cap-0"],
						foregroundIds: ["cap-1"],
					}),
				).toEqual({ status: "invalid-foreground" });
				expect(yield* tokens).toEqual({});
				yield* store.replaceInterest({
					sessionId,
					revision: 1,
					entityIds: members,
					foregroundIds: members.slice(0, MAX_FOREGROUND_ENTITY_IDS),
				});
				const update = (input: {
					readonly add?: readonly string[];
					readonly remove?: readonly string[];
					readonly addForeground?: readonly string[];
					readonly removeForeground?: readonly string[];
				}) =>
					store.updateInterest({
						sessionId,
						revision: 2,
						add: input.add ?? [],
						remove: input.remove ?? [],
						addForeground: input.addForeground ?? [],
						removeForeground: input.removeForeground ?? [],
					});
				const extra = `cap-${MAX_FOREGROUND_ENTITY_IDS}`;

				expect(yield* update({ addForeground: [extra] })).toEqual({ status: "limit-exceeded" });
				expect(yield* update({ addForeground: ["not-a-member"] })).toEqual({
					status: "invalid-foreground",
				});
				expect(yield* update({ remove: [extra], removeForeground: [extra] })).toEqual({
					status: "invalid-foreground",
				});
				expect(yield* update({ remove: ["cap-0"], addForeground: [extra] })).toMatchObject({
					revision: 2,
					status: "applied",
				});
				expect((yield* tokens)[extra]).toBe("pending:2:f");
			}),
		),
	);
});
