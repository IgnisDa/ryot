import { expect, it, layer } from "@effect/vitest";
import {
	MAX_FOREGROUND_ENTITY_IDS,
	MAX_INTEREST_ENTITY_IDS,
} from "@ryot-app/contract/modules/entity-watches/messages";
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
	test.effect(
		"replaces complete sets, keeps retained tokens, and fences remove-and-re-add work",
		() =>
			withSession(["a", "b", "c"], ({ store, tokens, sessionId }) =>
				Effect.gen(function* () {
					const replace = (
						revision: number,
						entityIds: readonly string[],
						foregroundIds: readonly string[],
					) => store.replaceInterest({ revision, sessionId, entityIds, foregroundIds });
					yield* replace(1, ["a", "b", "b"], ["a", "a"]);
					expect(yield* tokens).toEqual({ a: "pending:1:f", b: "pending:1:v" });
					expect(yield* store.listInterestedSessions("a")).toContain(sessionId);
					yield* replace(2, ["b", "c"], ["c"]);
					expect(yield* tokens).toEqual({ b: "pending:1:v", c: "pending:2:f" });
					expect(yield* store.listInterestedSessions("a")).not.toContain(sessionId);
					expect(yield* store.listInterestedSessions("b")).toContain(sessionId);
					expect(yield* store.listInterestedSessions("c")).toContain(sessionId);
					yield* store.markReconciled({
						sessionId,
						pending: [{ revision: 1, entityId: "b", priority: "visible" }],
					});
					yield* replace(3, ["c", "b"], ["c"]);
					expect(yield* tokens).toEqual({ b: "watching:v", c: "pending:2:f" });
					expect(yield* replace(4, [], [])).toEqual({
						revision: 4,
						pending: [],
						status: "applied",
					});
					expect(yield* tokens).toEqual({});
					for (const id of ["a", "b", "c"]) {
						expect(yield* store.listInterestedSessions(id)).not.toContain(sessionId);
					}
					yield* replace(5, ["a"], ["a"]);
					const stale = [{ revision: 1, entityId: "a", priority: "foreground" as const }];
					expect(yield* store.markReconciled({ sessionId, pending: stale })).toEqual([]);
					expect(yield* store.removePending({ sessionId, pending: stale })).toEqual([]);
					expect(yield* tokens).toEqual({ a: "pending:5:f" });
					expect(yield* store.listInterestedSessions("a")).toContain(sessionId);
					expect(
						yield* store.markReconciled({
							sessionId,
							pending: [{ revision: 5, entityId: "a", priority: "foreground" }],
						}),
					).toEqual(["a"]);
					yield* replace(6, ["a"], ["a"]);
					expect(yield* tokens).toEqual({ a: "watching:f" });
				}),
			),
	);

	test.effect(
		"accepts 500 members plus 50 foreground IDs and rejects replacements atomically",
		() =>
			withSession(ids("members", MAX_INTEREST_ENTITY_IDS + 1), ({ store, tokens, sessionId }) =>
				Effect.gen(function* () {
					const members = ids("members", MAX_INTEREST_ENTITY_IDS);
					const foreground = members.slice(0, MAX_FOREGROUND_ENTITY_IDS);
					const replace = (
						revision: number,
						entityIds: readonly string[],
						foregroundIds: readonly string[],
					) => store.replaceInterest({ revision, sessionId, entityIds, foregroundIds });
					expect(yield* replace(2, members, foreground)).toEqual({ status: "revision-mismatch" });
					expect(yield* tokens).toEqual({});
					yield* replace(1, members, foreground);
					const before = yield* tokens;
					expect(Object.keys(before)).toHaveLength(500);
					expect(Object.values(before).filter((token) => token === "pending:1:f")).toHaveLength(50);
					expect(yield* replace(2, [...members, "members-500"], foreground)).toEqual({
						status: "limit-exceeded",
					});
					expect(yield* replace(2, members, members.slice(0, 51))).toEqual({
						status: "limit-exceeded",
					});
					expect(yield* replace(2, members.slice(1), ["members-0"])).toEqual({
						status: "invalid-foreground",
					});
					expect(yield* replace(1, [], [])).toEqual({ status: "revision-mismatch" });
					expect(yield* tokens).toEqual(before);
					expect(yield* store.listInterestedSessions("members-0")).toContain(sessionId);
					expect(yield* store.listInterestedSessions("members-500")).not.toContain(sessionId);
					expect((yield* store.getSessionMetadata([sessionId]))[0]?.revision).toBe(1);
					expect(yield* replace(2, [], [])).toEqual({
						revision: 2,
						pending: [],
						status: "applied",
					});
					yield* store.closeSession(sessionId);
					expect(yield* replace(3, members, foreground)).toEqual({ status: "missing-session" });
					expect(yield* tokens).toEqual({});
				}),
			),
	);

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

				const updated = yield* store.replaceInterest({
					sessionId,
					revision: 2,
					foregroundIds: ["a"],
					entityIds: ["a", "b"],
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
				const replace = (revision: number, foregroundIds: readonly string[]) =>
					store.replaceInterest({ revision, sessionId, foregroundIds, entityIds: ["a"] });
				yield* replace(2, ["a"]);
				expect(yield* replace(3, [])).toEqual({
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
				const replace = (entityIds: readonly string[], foregroundIds: readonly string[]) =>
					store.replaceInterest({ sessionId, entityIds, revision: 2, foregroundIds });
				const extra = `cap-${MAX_FOREGROUND_ENTITY_IDS}`;
				const before = yield* tokens;

				expect(yield* replace(members, members.slice(0, MAX_FOREGROUND_ENTITY_IDS + 1))).toEqual({
					status: "limit-exceeded",
				});
				expect(yield* replace(members, ["not-a-member"])).toEqual({ status: "invalid-foreground" });
				expect(
					yield* replace(
						members.filter((id) => id !== extra),
						[extra],
					),
				).toEqual({ status: "invalid-foreground" });
				expect(yield* tokens).toEqual(before);
				expect(
					yield* replace(members.slice(1), members.slice(1, MAX_FOREGROUND_ENTITY_IDS + 1)),
				).toMatchObject({ revision: 2, status: "applied" });
				expect((yield* tokens)[extra]).toBe("pending:2:f");
			}),
		),
	);
});
