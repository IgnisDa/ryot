import { notFound } from "@ryot-app/contract/errors";
import { MAX_INTEREST_ENTITY_IDS } from "@ryot-app/contract/modules/entity-interest/messages";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Context, Effect, Layer, Schema } from "effect";

import {
	ENTITY_INTEREST_SESSION_TTL_SECONDS,
	redisKeys,
	RedisService,
} from "#lib/infrastructure/redis";

const REVERSE_KEY_SUFFIX = ":sessions";
const SESSION_NOT_FOUND = "Unknown session";
const SESSION_KEY_PREFIX = "ryot:entity-interest:session:";
const REVERSE_KEY_PREFIX = "ryot:entity-interest:entity:";
const SESSION_TTL_MILLISECONDS = ENTITY_INTEREST_SESSION_TTL_SECONDS * 1_000;

const OPEN_SESSION_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 'exists'
end
redis.call('HSET', KEYS[1], 'userId', ARGV[1], 'preferredLanguage', ARGV[2], 'revision', '0')
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 'ok'
`;

const REPLACE_INTEREST_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return { 'missing-session' }
end
local currentRevision = tonumber(redis.call('HGET', KEYS[1], 'revision'))
local incomingRevision = tonumber(ARGV[1])
if not currentRevision or incomingRevision ~= currentRevision + 1 then
  return { 'revision-mismatch' }
end
local requested = {}
local requestedIds = {}
for index = 8, #ARGV do
  local entityId = ARGV[index]
  if not requested[entityId] then
    requested[entityId] = true
    table.insert(requestedIds, entityId)
  end
end
if #requestedIds > tonumber(ARGV[5]) then
  return { 'limit-exceeded' }
end
local current = redis.call('HKEYS', KEYS[2])
for _, entityId in ipairs(current) do
  if not requested[entityId] then
    redis.call('HDEL', KEYS[2], entityId)
    redis.call('ZREM', ARGV[6] .. entityId .. ARGV[7], ARGV[2])
  end
end
for _, entityId in ipairs(requestedIds) do
  if redis.call('HEXISTS', KEYS[2], entityId) == 0 then
    redis.call('HSET', KEYS[2], entityId, 'pending:' .. ARGV[1])
  end
  redis.call('ZADD', ARGV[6] .. entityId .. ARGV[7], ARGV[3], ARGV[2])
end
redis.call('HSET', KEYS[1], 'revision', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[4])
if redis.call('EXISTS', KEYS[2]) == 1 then
  redis.call('EXPIRE', KEYS[2], ARGV[4])
end
local result = { 'applied', ARGV[1] }
local memberships = redis.call('HGETALL', KEYS[2])
for index = 1, #memberships, 2 do
  local revision = string.match(memberships[index + 1], '^pending:(%d+)$')
  if revision then
    table.insert(result, memberships[index])
    table.insert(result, revision)
  end
end
return result
`;

const UPDATE_INTEREST_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return { 'missing-session' }
end
local currentRevision = tonumber(redis.call('HGET', KEYS[1], 'revision'))
local incomingRevision = tonumber(ARGV[1])
if not currentRevision or incomingRevision ~= currentRevision + 1 then
  return { 'revision-mismatch' }
end
local addCount = tonumber(ARGV[8])
local add = {}
local addIds = {}
for index = 9, 8 + addCount do
  local entityId = ARGV[index]
  if not add[entityId] then
    add[entityId] = true
    table.insert(addIds, entityId)
  end
end
local remove = {}
local removeIds = {}
for index = 9 + addCount, #ARGV do
  local entityId = ARGV[index]
  if add[entityId] then
    return { 'overlap' }
  end
  if not remove[entityId] then
    remove[entityId] = true
    table.insert(removeIds, entityId)
  end
end
local finalCount = redis.call('HLEN', KEYS[2])
for _, entityId in ipairs(removeIds) do
  if redis.call('HEXISTS', KEYS[2], entityId) == 1 then
    finalCount = finalCount - 1
  end
end
for _, entityId in ipairs(addIds) do
  if redis.call('HEXISTS', KEYS[2], entityId) == 0 then
    finalCount = finalCount + 1
  end
end
if finalCount > tonumber(ARGV[5]) then
  return { 'limit-exceeded' }
end
for _, entityId in ipairs(removeIds) do
  redis.call('HDEL', KEYS[2], entityId)
  redis.call('ZREM', ARGV[6] .. entityId .. ARGV[7], ARGV[2])
end
for _, entityId in ipairs(addIds) do
  if redis.call('HEXISTS', KEYS[2], entityId) == 0 then
    redis.call('HSET', KEYS[2], entityId, 'pending:' .. ARGV[1])
  end
end
local current = redis.call('HKEYS', KEYS[2])
for _, entityId in ipairs(current) do
  redis.call('ZADD', ARGV[6] .. entityId .. ARGV[7], ARGV[3], ARGV[2])
end
redis.call('HSET', KEYS[1], 'revision', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[4])
if redis.call('EXISTS', KEYS[2]) == 1 then
  redis.call('EXPIRE', KEYS[2], ARGV[4])
end
local result = { 'applied', ARGV[1] }
local memberships = redis.call('HGETALL', KEYS[2])
for index = 1, #memberships, 2 do
  local revision = string.match(memberships[index + 1], '^pending:(%d+)$')
  if revision then
    table.insert(result, memberships[index])
    table.insert(result, revision)
  end
end
return result
`;

const MARK_RECONCILED_SCRIPT = `
local reconciled = {}
for index = 1, #ARGV, 2 do
  local entityId = ARGV[index]
  local expected = 'pending:' .. ARGV[index + 1]
  if redis.call('HGET', KEYS[1], entityId) == expected then
    redis.call('HSET', KEYS[1], entityId, 'watching')
    table.insert(reconciled, entityId)
  end
end
return reconciled
`;

const REMOVE_PENDING_SCRIPT = `
local removed = {}
for index = 4, #ARGV, 2 do
  local entityId = ARGV[index]
  local expected = 'pending:' .. ARGV[index + 1]
  if redis.call('HGET', KEYS[1], entityId) == expected then
    redis.call('HDEL', KEYS[1], entityId)
    redis.call('ZREM', ARGV[2] .. entityId .. ARGV[3], ARGV[1])
    table.insert(removed, entityId)
  end
end
return removed
`;

const MARK_PENDING_SCRIPT = `
for index = 1, #KEYS, 2 do
  local revision = redis.call('HGET', KEYS[index], 'revision')
  if revision and redis.call('HEXISTS', KEYS[index + 1], ARGV[1]) == 1 then
    redis.call('HSET', KEYS[index + 1], ARGV[1], 'pending:' .. revision)
  end
end
return 1
`;

const RENEW_SESSION_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'missing'
end
local entityIds = redis.call('HKEYS', KEYS[2])
for _, entityId in ipairs(entityIds) do
  redis.call('ZADD', ARGV[4] .. entityId .. ARGV[5], ARGV[2], ARGV[1])
end
redis.call('EXPIRE', KEYS[1], ARGV[3])
if redis.call('EXISTS', KEYS[2]) == 1 then
  redis.call('EXPIRE', KEYS[2], ARGV[3])
end
return 'ok'
`;

const CLOSE_SESSION_SCRIPT = `
local exists = redis.call('EXISTS', KEYS[1])
local entityIds = redis.call('HKEYS', KEYS[2])
for _, entityId in ipairs(entityIds) do
  redis.call('ZREM', ARGV[2] .. entityId .. ARGV[3], ARGV[1])
end
redis.call('DEL', KEYS[1], KEYS[2])
if exists == 1 then
  return 'ok'
end
return 'missing'
`;

const HAS_INTEREST_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
return redis.call('HEXISTS', KEYS[2], ARGV[1])
`;

const LIST_WATCHING_SESSIONS_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local watching = {}
local sessionIds = redis.call('ZRANGEBYSCORE', KEYS[1], ARGV[1], '+inf')
for _, sessionId in ipairs(sessionIds) do
  local sessionKey = ARGV[3] .. sessionId
  if redis.call('EXISTS', sessionKey) == 0 then
    redis.call('ZREM', KEYS[1], sessionId)
  elseif redis.call('HGET', sessionKey .. ':entities', ARGV[2]) == 'watching' then
    table.insert(watching, sessionId)
  end
end
return watching
`;

export type PendingInterest = { readonly revision: number; readonly entityId: string };

type InterestCommandOutcome =
	| { readonly status: "overlap" }
	| { readonly status: "limit-exceeded" }
	| { readonly status: "missing-session" }
	| { readonly status: "revision-mismatch" }
	| {
			readonly status: "applied";
			readonly revision: number;
			readonly pending: readonly PendingInterest[];
	  };

const SessionMetadata = Schema.Struct({
	userId: UserId,
	revision: Schema.Finite,
	sessionId: Schema.String,
	preferredLanguage: Schema.NullOr(Schema.String),
});
type SessionMetadata = typeof SessionMetadata.Type;

const sessionKeys = (sessionId: string) => [
	redisKeys.entityInterestSession(sessionId),
	redisKeys.entityInterestSessionEntities(sessionId),
];

export class EntityInterestStore extends Context.Service<EntityInterestStore>()(
	"EntityInterestStore",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const evaluate = (script: string, keys: readonly string[], args: readonly string[]) =>
				Effect.tryPromise(() => redis.client.eval(script, keys.length, ...keys, ...args)).pipe(
					Effect.orDie,
				);
			const commandArgs = Effect.fn(function* (sessionId: string, revision: number) {
				const expiresAt = (yield* Clock.currentTimeMillis) + SESSION_TTL_MILLISECONDS;
				return [
					String(revision),
					sessionId,
					String(expiresAt),
					String(ENTITY_INTEREST_SESSION_TTL_SECONDS),
					String(MAX_INTEREST_ENTITY_IDS),
					REVERSE_KEY_PREFIX,
					REVERSE_KEY_SUFFIX,
				];
			});
			const parseCommandOutcome = (result: unknown): InterestCommandOutcome => {
				if (!Array.isArray(result) || !result.every((value) => typeof value === "string")) {
					throw new Error("Redis returned an invalid entity interest command outcome");
				}
				const [status, rawRevision, ...rawPending] = result;
				if (
					status === "missing-session" ||
					status === "revision-mismatch" ||
					status === "limit-exceeded" ||
					status === "overlap"
				) {
					return { status };
				}
				const revision = Number(rawRevision);
				if (
					status !== "applied" ||
					!Number.isSafeInteger(revision) ||
					rawPending.length % 2 !== 0
				) {
					throw new Error("Redis returned an invalid entity interest command outcome");
				}
				const pending: PendingInterest[] = [];
				for (let index = 0; index < rawPending.length; index += 2) {
					const entityId = rawPending[index];
					const pendingRevision = Number(rawPending[index + 1]);
					if (entityId === undefined || !Number.isSafeInteger(pendingRevision)) {
						throw new Error("Redis returned an invalid pending interest token");
					}
					pending.push({ entityId, revision: pendingRevision });
				}
				return { status, pending, revision };
			};

			const openSession = Effect.fn("EntityInterestStore.openSession")(function* (input: {
				readonly userId: UserId;
				readonly sessionId: string;
				readonly preferredLanguage: string | null;
			}) {
				const result = yield* evaluate(
					OPEN_SESSION_SCRIPT,
					[redisKeys.entityInterestSession(input.sessionId)],
					[
						input.userId,
						input.preferredLanguage ?? "",
						String(ENTITY_INTEREST_SESSION_TTL_SECONDS),
					],
				);
				if (result === "exists") {
					return yield* notFound(SESSION_NOT_FOUND);
				}
				return undefined;
			});

			const replaceInterest = Effect.fn("EntityInterestStore.replaceInterest")(function* (input: {
				readonly revision: number;
				readonly sessionId: string;
				readonly entityIds: readonly string[];
			}) {
				const args = yield* commandArgs(input.sessionId, input.revision);
				return parseCommandOutcome(
					yield* evaluate(REPLACE_INTEREST_SCRIPT, sessionKeys(input.sessionId), [
						...args,
						...input.entityIds,
					]),
				);
			});

			const updateInterest = Effect.fn("EntityInterestStore.updateInterest")(function* (input: {
				readonly revision: number;
				readonly sessionId: string;
				readonly add: readonly string[];
				readonly remove: readonly string[];
			}) {
				const args = yield* commandArgs(input.sessionId, input.revision);
				return parseCommandOutcome(
					yield* evaluate(UPDATE_INTEREST_SCRIPT, sessionKeys(input.sessionId), [
						...args,
						String(input.add.length),
						...input.add,
						...input.remove,
					]),
				);
			});

			const markReconciled = Effect.fn("EntityInterestStore.markReconciled")(function* (input: {
				readonly sessionId: string;
				readonly pending: readonly PendingInterest[];
			}) {
				if (input.pending.length === 0) {
					return [];
				}
				const result = yield* evaluate(
					MARK_RECONCILED_SCRIPT,
					[redisKeys.entityInterestSessionEntities(input.sessionId)],
					input.pending.flatMap(({ entityId, revision }) => [entityId, String(revision)]),
				);
				if (
					!Array.isArray(result) ||
					!result.every((value): value is string => typeof value === "string")
				) {
					return yield* Effect.die("Redis returned invalid reconciled memberships");
				}
				return result;
			});

			const markPending = Effect.fn("EntityInterestStore.markPending")(function* (input: {
				readonly entityId: string;
				readonly sessionIds: readonly string[];
			}) {
				if (input.sessionIds.length === 0) {
					return;
				}
				yield* evaluate(MARK_PENDING_SCRIPT, input.sessionIds.flatMap(sessionKeys), [
					input.entityId,
				]);
			});

			const removePending = Effect.fn("EntityInterestStore.removePending")(function* (input: {
				readonly sessionId: string;
				readonly pending: readonly PendingInterest[];
			}) {
				if (input.pending.length === 0) {
					return [];
				}
				const result = yield* evaluate(
					REMOVE_PENDING_SCRIPT,
					[redisKeys.entityInterestSessionEntities(input.sessionId)],
					[
						input.sessionId,
						REVERSE_KEY_PREFIX,
						REVERSE_KEY_SUFFIX,
						...input.pending.flatMap(({ entityId, revision }) => [entityId, String(revision)]),
					],
				);
				if (
					!Array.isArray(result) ||
					!result.every((value): value is string => typeof value === "string")
				) {
					return yield* Effect.die("Redis returned invalid removed pending memberships");
				}
				return result;
			});

			const renewSession = Effect.fn("EntityInterestStore.renewSession")(function* (
				sessionId: string,
			) {
				const expiresAt = (yield* Clock.currentTimeMillis) + SESSION_TTL_MILLISECONDS;
				const result = yield* evaluate(RENEW_SESSION_SCRIPT, sessionKeys(sessionId), [
					sessionId,
					String(expiresAt),
					String(ENTITY_INTEREST_SESSION_TTL_SECONDS),
					REVERSE_KEY_PREFIX,
					REVERSE_KEY_SUFFIX,
				]);
				return result === "ok";
			});

			const closeSession = Effect.fn("EntityInterestStore.closeSession")(function* (
				sessionId: string,
			) {
				const result = yield* evaluate(CLOSE_SESSION_SCRIPT, sessionKeys(sessionId), [
					sessionId,
					REVERSE_KEY_PREFIX,
					REVERSE_KEY_SUFFIX,
				]);
				return result === "ok";
			});

			const hasInterest = Effect.fn("EntityInterestStore.hasInterest")(function* (
				sessionId: string,
				entityId: string,
			) {
				const result = yield* evaluate(HAS_INTEREST_SCRIPT, sessionKeys(sessionId), [entityId]);
				return result === 1;
			});

			const getSessionMetadata = Effect.fn("EntityInterestStore.getSessionMetadata")(function* (
				sessionIds: readonly string[],
			) {
				const rows = yield* Effect.tryPromise(() =>
					Promise.all(
						sessionIds.map((sessionId) =>
							redis.client.hgetall(redisKeys.entityInterestSession(sessionId)),
						),
					),
				).pipe(Effect.orDie);
				const metadata: SessionMetadata[] = [];
				for (let index = 0; index < rows.length; index += 1) {
					const row = rows[index];
					const sessionId = sessionIds[index];
					if (row === undefined || sessionId === undefined || row["userId"] === undefined) {
						continue;
					}
					const revision = Number(row["revision"]);
					if (!Number.isSafeInteger(revision)) {
						return yield* Effect.die("Redis returned invalid entity interest metadata");
					}
					metadata.push({
						revision,
						sessionId,
						userId: UserId.make(row["userId"]),
						preferredLanguage:
							row["preferredLanguage"] === "" ? null : (row["preferredLanguage"] ?? null),
					});
				}
				return metadata;
			});

			const listInterestedSessions = Effect.fn("EntityInterestStore.listInterestedSessions")(
				function* (entityId: string) {
					const key = redisKeys.entityInterestSessions(entityId);
					const now = yield* Clock.currentTimeMillis;
					yield* Effect.tryPromise(() => redis.client.zremrangebyscore(key, "-inf", now)).pipe(
						Effect.orDie,
					);
					const sessionIds = yield* Effect.tryPromise(() =>
						redis.client.zrangebyscore(key, now, "+inf"),
					).pipe(Effect.orDie);
					const metadata = yield* getSessionMetadata(sessionIds);
					const existing = new Set(metadata.map(({ sessionId }) => sessionId));
					const missing = sessionIds.filter((sessionId) => !existing.has(sessionId));
					if (missing.length > 0) {
						yield* Effect.tryPromise(() => redis.client.zrem(key, ...missing)).pipe(Effect.orDie);
					}
					return metadata.map(({ sessionId }) => sessionId);
				},
			);
			const listWatchingSessions = Effect.fn("EntityInterestStore.listWatchingSessions")(function* (
				entityId: string,
			) {
				const now = yield* Clock.currentTimeMillis;
				const result = yield* evaluate(
					LIST_WATCHING_SESSIONS_SCRIPT,
					[redisKeys.entityInterestSessions(entityId)],
					[String(now), entityId, SESSION_KEY_PREFIX],
				);
				if (
					!Array.isArray(result) ||
					!result.every((value): value is string => typeof value === "string")
				) {
					return yield* Effect.die("Redis returned invalid watching memberships");
				}
				return result;
			});

			return {
				openSession,
				hasInterest,
				markPending,
				closeSession,
				renewSession,
				removePending,
				updateInterest,
				markReconciled,
				replaceInterest,
				getSessionMetadata,
				listWatchingSessions,
				listInterestedSessions,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
