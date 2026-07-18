import { notFound } from "@ryot/contract/errors";
import { MAX_INTEREST_ENTITY_IDS } from "@ryot/contract/modules/entity-interest/messages";
import { UserId } from "@ryot/contract/schema/brands";
import { Clock, Context, Effect, Layer, Schema } from "effect";

import {
	ENTITY_INTEREST_STREAM_TTL_SECONDS,
	redisKeys,
	RedisService,
} from "#lib/infrastructure/redis";

const REVERSE_KEY_SUFFIX = ":streams";
const STREAM_NOT_FOUND = "Unknown stream";
const REVERSE_KEY_PREFIX = "ryot:entity-interest:entity:";
const STREAM_TTL_MILLISECONDS = ENTITY_INTEREST_STREAM_TTL_SECONDS * 1_000;

const OPEN_STREAM_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 'not_found'
end
redis.call('HSET', KEYS[1], 'userId', ARGV[1], 'preferredLanguage', ARGV[2], 'generation', '0')
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 'ok'
`;

const REPLACE_INTEREST_SCRIPT = `
if redis.call('HGET', KEYS[1], 'userId') ~= ARGV[1] then
  return 'not_found'
end
local current = redis.call('HKEYS', KEYS[2])
if #current > tonumber(ARGV[6]) then
  return 'invalid'
end
local requested = {}
for index = 9, #ARGV do
  requested[ARGV[index]] = true
end
for _, entityId in ipairs(current) do
  if not requested[entityId] then
    redis.call('HDEL', KEYS[2], entityId)
    redis.call('ZREM', ARGV[7] .. entityId .. ARGV[8], ARGV[3])
  end
end
local pending = {}
for index = 9, #ARGV do
  local entityId = ARGV[index]
  local state = redis.call('HGET', KEYS[2], entityId)
  if not state then
    state = 'pending'
    redis.call('HSET', KEYS[2], entityId, state)
  end
  redis.call('ZADD', ARGV[7] .. entityId .. ARGV[8], ARGV[4], ARGV[3])
  if state == 'pending' then
    table.insert(pending, entityId)
  end
end
local generation = redis.call('HINCRBY', KEYS[1], 'generation', 1)
redis.call('HSET', KEYS[1], 'preferredLanguage', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[5])
if redis.call('EXISTS', KEYS[2]) == 1 then
  redis.call('EXPIRE', KEYS[2], ARGV[5])
end
local result = { tostring(generation) }
for _, entityId in ipairs(pending) do
  table.insert(result, entityId)
end
return result
`;

const MARK_RECONCILED_SCRIPT = `
if redis.call('HGET', KEYS[1], 'generation') ~= ARGV[1] then
  return 0
end
if #ARGV - 2 > tonumber(ARGV[2]) then
  return 'invalid'
end
for index = 3, #ARGV do
  if redis.call('HGET', KEYS[2], ARGV[index]) == 'pending' then
    redis.call('HSET', KEYS[2], ARGV[index], 'watching')
  end
end
return 1
`;

const MARK_PENDING_SCRIPT = `
for index = 1, #KEYS do
  if redis.call('HEXISTS', KEYS[index], ARGV[1]) == 1 then
    redis.call('HSET', KEYS[index], ARGV[1], 'pending')
  end
end
return 1
`;

const RENEW_STREAM_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'missing'
end
local entityIds = redis.call('HKEYS', KEYS[2])
if #entityIds > tonumber(ARGV[4]) then
  return 'invalid'
end
for _, entityId in ipairs(entityIds) do
  redis.call('ZADD', ARGV[5] .. entityId .. ARGV[6], ARGV[2], ARGV[1])
end
redis.call('EXPIRE', KEYS[1], ARGV[3])
if redis.call('EXISTS', KEYS[2]) == 1 then
  redis.call('EXPIRE', KEYS[2], ARGV[3])
end
return 'ok'
`;

const CLOSE_STREAM_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'missing'
end
local entityIds = redis.call('HKEYS', KEYS[2])
if #entityIds > tonumber(ARGV[2]) then
  return 'invalid'
end
for _, entityId in ipairs(entityIds) do
  redis.call('ZREM', ARGV[3] .. entityId .. ARGV[4], ARGV[1])
end
redis.call('DEL', KEYS[1], KEYS[2])
return 'ok'
`;

const HAS_INTEREST_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
return redis.call('HEXISTS', KEYS[2], ARGV[1])
`;

const StreamMetadata = Schema.Struct({
	userId: UserId,
	streamId: Schema.String,
	generation: Schema.Finite,
	preferredLanguage: Schema.NullOr(Schema.String),
});
type StreamMetadata = typeof StreamMetadata.Type;

const deduplicateInterest = (entityIds: readonly string[]) =>
	Array.from(new Set(entityIds)).slice(0, MAX_INTEREST_ENTITY_IDS);
const streamKeys = (streamId: string) => [
	redisKeys.entityInterestStream(streamId),
	redisKeys.entityInterestStreamEntities(streamId),
];
const ensureValidBound = (result: unknown) =>
	result === "invalid"
		? Effect.die("Redis entity interest membership exceeded its bound")
		: Effect.succeed(result);

export class EntityInterestStore extends Context.Service<EntityInterestStore>()(
	"EntityInterestStore",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const evaluate = (script: string, keys: readonly string[], args: readonly string[]) =>
				Effect.tryPromise(() => redis.client.eval(script, keys.length, ...keys, ...args)).pipe(
					Effect.orDie,
				);
			const openStream = Effect.fn("EntityInterestStore.openStream")(function* (input: {
				readonly userId: UserId;
				readonly streamId: string;
				readonly preferredLanguage: string | null;
			}) {
				const result = yield* evaluate(
					OPEN_STREAM_SCRIPT,
					[redisKeys.entityInterestStream(input.streamId)],
					[input.userId, input.preferredLanguage ?? "", String(ENTITY_INTEREST_STREAM_TTL_SECONDS)],
				);
				if (result === "not_found") {
					return yield* notFound(STREAM_NOT_FOUND);
				}
				return undefined;
			});

			const replaceInterest = Effect.fn("EntityInterestStore.replaceInterest")(function* (input: {
				readonly userId: UserId;
				readonly streamId: string;
				readonly entityIds: readonly string[];
				readonly preferredLanguage: string | null;
			}) {
				const entityIds = deduplicateInterest(input.entityIds);
				const expiresAt = (yield* Clock.currentTimeMillis) + STREAM_TTL_MILLISECONDS;
				const result = yield* evaluate(REPLACE_INTEREST_SCRIPT, streamKeys(input.streamId), [
					input.userId,
					input.preferredLanguage ?? "",
					input.streamId,
					String(expiresAt),
					String(ENTITY_INTEREST_STREAM_TTL_SECONDS),
					String(MAX_INTEREST_ENTITY_IDS),
					REVERSE_KEY_PREFIX,
					REVERSE_KEY_SUFFIX,
					...entityIds,
				]);
				if (result === "not_found") {
					return yield* notFound(STREAM_NOT_FOUND);
				}
				yield* ensureValidBound(result);
				if (
					!Array.isArray(result) ||
					result.length === 0 ||
					!result.every((value): value is string => typeof value === "string")
				) {
					return yield* Effect.die("Redis returned an invalid entity interest replacement");
				}
				const [rawGeneration, ...pendingEntityIds] = result;
				const generation = Number(rawGeneration);
				if (!Number.isSafeInteger(generation)) {
					return yield* Effect.die("Redis returned an invalid entity interest generation");
				}
				return { generation, pendingEntityIds };
			});

			const markReconciled = Effect.fn("EntityInterestStore.markReconciled")(function* (input: {
				readonly streamId: string;
				readonly generation: number;
				readonly entityIds: readonly string[];
			}) {
				const entityIds = deduplicateInterest(input.entityIds);
				const result = yield* evaluate(MARK_RECONCILED_SCRIPT, streamKeys(input.streamId), [
					String(input.generation),
					String(MAX_INTEREST_ENTITY_IDS),
					...entityIds,
				]);
				yield* ensureValidBound(result);
				return result === 1;
			});

			const markPending = Effect.fn("EntityInterestStore.markPending")(function* (input: {
				readonly entityId: string;
				readonly streamIds: readonly string[];
			}) {
				if (input.streamIds.length === 0) {
					return;
				}
				yield* evaluate(
					MARK_PENDING_SCRIPT,
					input.streamIds.map(redisKeys.entityInterestStreamEntities),
					[input.entityId],
				);
			});

			const renewStream = Effect.fn("EntityInterestStore.renewStream")(function* (
				streamId: string,
			) {
				const expiresAt = (yield* Clock.currentTimeMillis) + STREAM_TTL_MILLISECONDS;
				const result = yield* evaluate(RENEW_STREAM_SCRIPT, streamKeys(streamId), [
					streamId,
					String(expiresAt),
					String(ENTITY_INTEREST_STREAM_TTL_SECONDS),
					String(MAX_INTEREST_ENTITY_IDS),
					REVERSE_KEY_PREFIX,
					REVERSE_KEY_SUFFIX,
				]);
				yield* ensureValidBound(result);
				return result === "ok";
			});

			const closeStream = Effect.fn("EntityInterestStore.closeStream")(function* (
				streamId: string,
			) {
				const result = yield* evaluate(CLOSE_STREAM_SCRIPT, streamKeys(streamId), [
					streamId,
					String(MAX_INTEREST_ENTITY_IDS),
					REVERSE_KEY_PREFIX,
					REVERSE_KEY_SUFFIX,
				]);
				yield* ensureValidBound(result);
				return result === "ok";
			});

			const hasInterest = Effect.fn("EntityInterestStore.hasInterest")(function* (
				streamId: string,
				entityId: string,
			) {
				const result = yield* evaluate(HAS_INTEREST_SCRIPT, streamKeys(streamId), [entityId]);
				return result === 1;
			});

			const getStreamMetadata = Effect.fn("EntityInterestStore.getStreamMetadata")(function* (
				streamIds: readonly string[],
			) {
				const rows = yield* Effect.tryPromise(() =>
					Promise.all(
						streamIds.map((streamId) =>
							redis.client.hgetall(redisKeys.entityInterestStream(streamId)),
						),
					),
				).pipe(Effect.orDie);
				const metadata: StreamMetadata[] = [];
				for (let index = 0; index < rows.length; index += 1) {
					const row = rows[index];
					const streamId = streamIds[index];
					if (row === undefined || streamId === undefined || row["userId"] === undefined) {
						continue;
					}
					const generation = Number(row["generation"]);
					if (!Number.isSafeInteger(generation)) {
						return yield* Effect.die("Redis returned invalid entity interest metadata");
					}
					metadata.push({
						streamId,
						generation,
						userId: UserId.make(row["userId"]),
						preferredLanguage:
							row["preferredLanguage"] === "" ? null : (row["preferredLanguage"] ?? null),
					});
				}
				return metadata;
			});

			const listInterestedStreams = Effect.fn("EntityInterestStore.listInterestedStreams")(
				function* (entityId: string) {
					const key = redisKeys.entityInterestStreams(entityId);
					const now = yield* Clock.currentTimeMillis;
					yield* Effect.tryPromise(() => redis.client.zremrangebyscore(key, "-inf", now)).pipe(
						Effect.orDie,
					);
					const streamIds = yield* Effect.tryPromise(() =>
						redis.client.zrangebyscore(key, now, "+inf"),
					).pipe(Effect.orDie);
					const metadata = yield* getStreamMetadata(streamIds);
					const existing = new Set(metadata.map(({ streamId }) => streamId));
					const missing = streamIds.filter((streamId) => !existing.has(streamId));
					if (missing.length > 0) {
						yield* Effect.tryPromise(() => redis.client.zrem(key, ...missing)).pipe(Effect.orDie);
					}
					return metadata.map(({ streamId }) => streamId);
				},
			);

			return {
				openStream,
				closeStream,
				hasInterest,
				markPending,
				renewStream,
				markReconciled,
				replaceInterest,
				getStreamMetadata,
				listInterestedStreams,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
