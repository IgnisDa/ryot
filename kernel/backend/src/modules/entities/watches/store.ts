import { notFound } from "@ryot-app/contract/errors";
import {
	type EntityWatchReplaceMessage,
	MAX_INTEREST_ENTITY_IDS,
} from "@ryot-app/contract/modules/entity-watches/messages";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Context, Effect, Layer, Schema } from "effect";

import { ENTITY_WATCH_SESSION_TTL_SECONDS, redisKeys, RedisService } from "#platform/redis";

const REVERSE_KEY_SUFFIX = ":sessions";
const SESSION_NOT_FOUND = "Unknown session";
const SESSION_KEY_PREFIX = "ryot:entity-watches:session:";
const REVERSE_KEY_PREFIX = "ryot:entity-watches:entity:";
const SESSION_TTL_MILLISECONDS = ENTITY_WATCH_SESSION_TTL_SECONDS * 1_000;

const OPEN_SESSION_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 'exists'
end
redis.call('HSET', KEYS[1], 'userId', ARGV[1], 'preferredLanguage', ARGV[2], 'revision', '0', 'accountGeneration', ARGV[4])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 'ok'
`;

const REPLACE_INTEREST_SCRIPT = `
local function tokenPriority(token)
  return token and string.match(token, ':([fv])$')
end
local function setPriority(key, entityId, priority, revision)
  local current = redis.call('HGET', key, entityId)
  local currentPriority = tokenPriority(current)
  if currentPriority == priority then
    return
  end
  if priority == 'v' and current and string.match(current, '^watching:') then
    redis.call('HSET', key, entityId, 'watching:v')
  else
    redis.call('HSET', key, entityId, 'pending:' .. revision .. ':' .. priority)
  end
end
local function appliedResult(key, revision)
  local result = { 'applied', revision }
  local memberships = redis.call('HGETALL', key)
  for index = 1, #memberships, 2 do
    local pendingRevision, priority = string.match(memberships[index + 1], '^pending:(%d+):([fv])$')
    if pendingRevision then
      table.insert(result, memberships[index])
      table.insert(result, pendingRevision)
      table.insert(result, priority)
    end
  end
  return result
end
if redis.call('EXISTS', KEYS[1]) == 0 then
  return { 'missing-session' }
end
local currentRevision = tonumber(redis.call('HGET', KEYS[1], 'revision'))
local incomingRevision = tonumber(ARGV[1])
if not currentRevision or incomingRevision ~= currentRevision + 1 then
  return { 'revision-mismatch' }
end
local entityCount = tonumber(ARGV[8])
local requested = {}
local requestedIds = {}
for index = 9, 8 + entityCount do
  local entityId = ARGV[index]
  if not requested[entityId] then
    requested[entityId] = true
    table.insert(requestedIds, entityId)
  end
end
local foreground = {}
for index = 9 + entityCount, #ARGV do
  foreground[ARGV[index]] = true
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
  setPriority(KEYS[2], entityId, foreground[entityId] and 'f' or 'v', ARGV[1])
  redis.call('ZADD', ARGV[6] .. entityId .. ARGV[7], ARGV[3], ARGV[2])
end
redis.call('HSET', KEYS[1], 'revision', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[4])
if redis.call('EXISTS', KEYS[2]) == 1 then
  redis.call('EXPIRE', KEYS[2], ARGV[4])
end
return appliedResult(KEYS[2], ARGV[1])
`;

const MARK_RECONCILED_SCRIPT = `
local reconciled = {}
for index = 1, #ARGV, 3 do
  local entityId = ARGV[index]
  local expected = 'pending:' .. ARGV[index + 1] .. ':' .. ARGV[index + 2]
  if redis.call('HGET', KEYS[1], entityId) == expected then
    redis.call('HSET', KEYS[1], entityId, 'watching:' .. ARGV[index + 2])
    table.insert(reconciled, entityId)
  end
end
return reconciled
`;

const REMOVE_PENDING_SCRIPT = `
local removed = {}
for index = 4, #ARGV, 3 do
  local entityId = ARGV[index]
  local expected = 'pending:' .. ARGV[index + 1] .. ':' .. ARGV[index + 2]
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
  local current = redis.call('HGET', KEYS[index + 1], ARGV[1])
  if revision and current then
    local priority = string.match(current, ':([fv])$') or 'v'
    redis.call('HSET', KEYS[index + 1], ARGV[1], 'pending:' .. revision .. ':' .. priority)
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
  elseif string.match(redis.call('HGET', sessionKey .. ':entities', ARGV[2]) or '', '^watching:') then
    table.insert(watching, sessionId)
  end
end
return watching
`;

export type InterestPriority = "foreground" | "visible";

export type PendingInterest = {
	readonly revision: number;
	readonly entityId: string;
	readonly priority: InterestPriority;
};

const priorityToken = (priority: InterestPriority) => (priority === "foreground" ? "f" : "v");

const pendingArgs = (pending: readonly PendingInterest[]) =>
	pending.flatMap(({ entityId, revision, priority }) => [
		entityId,
		String(revision),
		priorityToken(priority),
	]);

type InterestCommandOutcome =
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
	accountGeneration: AccountGeneration,
	preferredLanguage: Schema.NullOr(Schema.String),
});
type SessionMetadata = typeof SessionMetadata.Type;

const sessionKeys = (sessionId: string) => [
	redisKeys.entityWatchSession(sessionId),
	redisKeys.entityWatchSessionEntities(sessionId),
];

const parseCommandOutcome = (result: unknown): InterestCommandOutcome => {
	if (!Array.isArray(result) || !result.every((value) => typeof value === "string")) {
		throw new Error("Redis returned an invalid entity interest command outcome");
	}
	const [status, rawRevision, ...rawPending] = result;
	if (status === "missing-session" || status === "revision-mismatch" || status === "limit-exceeded") {
		return { status };
	}
	const revision = Number(rawRevision);
	if (status !== "applied" || !Number.isSafeInteger(revision) || rawPending.length % 3 !== 0) {
		throw new Error("Redis returned an invalid entity interest command outcome");
	}
	const pending: PendingInterest[] = [];
	for (let index = 0; index < rawPending.length; index += 3) {
		const entityId = rawPending[index];
		const pendingRevision = Number(rawPending[index + 1]);
		const priority = rawPending[index + 2];
		if (
			entityId === undefined ||
			!Number.isSafeInteger(pendingRevision) ||
			(priority !== "f" && priority !== "v")
		) {
			throw new Error("Redis returned an invalid pending interest token");
		}
		pending.push({
			entityId,
			revision: pendingRevision,
			priority: priority === "f" ? "foreground" : "visible",
		});
	}
	return { status, pending, revision };
};

export class EntityWatchStore extends Context.Service<EntityWatchStore>()("EntityWatchStore", {
	make: Effect.gen(function* () {
		const redis = yield* RedisService;
		const evaluate = (script: string, keys: readonly string[], args: readonly string[]) =>
			Effect.tryPromise(() => redis.client.eval(script, keys.length, ...keys, ...args)).pipe(
				Effect.orDie,
			);
		const openSession = Effect.fn("EntityWatchStore.openSession")(function* (input: {
			readonly userId: UserId;
			readonly accountGeneration: AccountGeneration;
			readonly sessionId: string;
			readonly preferredLanguage: string | null;
		}) {
			const result = yield* evaluate(
				OPEN_SESSION_SCRIPT,
				[redisKeys.entityWatchSession(input.sessionId)],
				[
					input.userId,
					input.preferredLanguage ?? "",
					String(ENTITY_WATCH_SESSION_TTL_SECONDS),
					input.accountGeneration.token,
				],
			);
			if (result === "exists") {
				return yield* notFound(SESSION_NOT_FOUND);
			}
			return undefined;
		});

		const replaceInterest = Effect.fn("EntityWatchStore.replaceInterest")(function* (
			input: Omit<EntityWatchReplaceMessage, "type"> & { readonly sessionId: string },
		) {
			const expiresAt = (yield* Clock.currentTimeMillis) + SESSION_TTL_MILLISECONDS;
			return parseCommandOutcome(
				yield* evaluate(REPLACE_INTEREST_SCRIPT, sessionKeys(input.sessionId), [
					String(input.revision),
					input.sessionId,
					String(expiresAt),
					String(ENTITY_WATCH_SESSION_TTL_SECONDS),
					String(MAX_INTEREST_ENTITY_IDS),
					REVERSE_KEY_PREFIX,
					REVERSE_KEY_SUFFIX,
					String(input.entityIds.length),
					...input.entityIds,
					...input.foregroundIds,
				]),
			);
		});

		const markReconciled = Effect.fn("EntityWatchStore.markReconciled")(function* (input: {
			readonly sessionId: string;
			readonly pending: readonly PendingInterest[];
		}) {
			if (input.pending.length === 0) {
				return [];
			}
			const result = yield* evaluate(
				MARK_RECONCILED_SCRIPT,
				[redisKeys.entityWatchSessionEntities(input.sessionId)],
				pendingArgs(input.pending),
			);
			if (
				!Array.isArray(result) ||
				!result.every((value): value is string => typeof value === "string")
			) {
				return yield* Effect.die("Redis returned invalid reconciled memberships");
			}
			return result;
		});

		const markPending = Effect.fn("EntityWatchStore.markPending")(function* (input: {
			readonly entityId: string;
			readonly sessionIds: readonly string[];
		}) {
			if (input.sessionIds.length === 0) {
				return;
			}
			yield* evaluate(MARK_PENDING_SCRIPT, input.sessionIds.flatMap(sessionKeys), [input.entityId]);
		});

		const removePending = Effect.fn("EntityWatchStore.removePending")(function* (input: {
			readonly sessionId: string;
			readonly pending: readonly PendingInterest[];
		}) {
			if (input.pending.length === 0) {
				return [];
			}
			const result = yield* evaluate(
				REMOVE_PENDING_SCRIPT,
				[redisKeys.entityWatchSessionEntities(input.sessionId)],
				[input.sessionId, REVERSE_KEY_PREFIX, REVERSE_KEY_SUFFIX, ...pendingArgs(input.pending)],
			);
			if (
				!Array.isArray(result) ||
				!result.every((value): value is string => typeof value === "string")
			) {
				return yield* Effect.die("Redis returned invalid removed pending memberships");
			}
			return result;
		});

		const renewSession = Effect.fn("EntityWatchStore.renewSession")(function* (sessionId: string) {
			const expiresAt = (yield* Clock.currentTimeMillis) + SESSION_TTL_MILLISECONDS;
			const result = yield* evaluate(RENEW_SESSION_SCRIPT, sessionKeys(sessionId), [
				sessionId,
				String(expiresAt),
				String(ENTITY_WATCH_SESSION_TTL_SECONDS),
				REVERSE_KEY_PREFIX,
				REVERSE_KEY_SUFFIX,
			]);
			return result === "ok";
		});

		const closeSession = Effect.fn("EntityWatchStore.closeSession")(function* (sessionId: string) {
			const result = yield* evaluate(CLOSE_SESSION_SCRIPT, sessionKeys(sessionId), [
				sessionId,
				REVERSE_KEY_PREFIX,
				REVERSE_KEY_SUFFIX,
			]);
			return result === "ok";
		});

		const hasInterest = Effect.fn("EntityWatchStore.hasInterest")(function* (
			sessionId: string,
			entityId: string,
		) {
			const result = yield* evaluate(HAS_INTEREST_SCRIPT, sessionKeys(sessionId), [entityId]);
			return result === 1;
		});

		const getSessionMetadata = Effect.fn("EntityWatchStore.getSessionMetadata")(function* (
			sessionIds: readonly string[],
		) {
			const rows = yield* Effect.tryPromise(() =>
				Promise.all(
					sessionIds.map((sessionId) =>
						redis.client.hgetall(redisKeys.entityWatchSession(sessionId)),
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
					accountGeneration: yield* Schema.decodeUnknownEffect(AccountGeneration)({
						userId: row["userId"],
						token: row["accountGeneration"],
					}),
				});
			}
			return metadata;
		});

		const listInterestedSessions = Effect.fn("EntityWatchStore.listInterestedSessions")(function* (
			entityId: string,
		) {
			const key = redisKeys.entityWatchSessions(entityId);
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
		});
		const listWatchingSessions = Effect.fn("EntityWatchStore.listWatchingSessions")(function* (
			entityId: string,
		) {
			const now = yield* Clock.currentTimeMillis;
			const result = yield* evaluate(
				LIST_WATCHING_SESSIONS_SCRIPT,
				[redisKeys.entityWatchSessions(entityId)],
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
			markReconciled,
			replaceInterest,
			getSessionMetadata,
			listWatchingSessions,
			listInterestedSessions,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
