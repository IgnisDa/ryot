import { Context, Effect, Layer, Schema } from "effect";

import { redisKeys, RedisService } from "./redis";

export class SandboxCrashStoreError extends Schema.TaggedError<SandboxCrashStoreError>()(
	"SandboxCrashStoreError",
	{ message: Schema.String },
) {}

const responseSchema = Schema.Literals(["allowed", "probation", "blocked", "recorded", "stale"]);
const decodeResponse = Schema.decodeUnknownEffect(responseSchema);
const identitySchema = Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(
	Schema.isMinLength(1),
	Schema.isMaxLength(2),
);
const decodeIdentities = Schema.decodeUnknownEffect(identitySchema);

const crashScript = `
local operation = ARGV[1]
local argument = ARGV[2]
local now_parts = redis.call("TIME")
local now = tonumber(now_parts[1]) * 1000 + math.floor(tonumber(now_parts[2]) / 1000)
local probation = false
local owned = true
for index = 1, #KEYS, 4 do
  local expected = { "zset", "string", "string", "string" }
  for offset = 0, 3 do
    local kind = redis.call("TYPE", KEYS[index + offset]).ok
    if kind ~= "none" and kind ~= expected[offset + 1] then return "corrupt" end
  end
  local blocked = redis.call("GET", KEYS[index + 1])
  local required = redis.call("GET", KEYS[index + 2])
  if (blocked and blocked ~= "1") or (required and required ~= "1") then return "corrupt" end
  local lease = redis.call("GET", KEYS[index + 3])
  if operation == "acquire" and (blocked or lease) then return "blocked" end
  if required then probation = true end
  if lease ~= argument then owned = false end
end
if operation == "acquire" then
  if not probation then return "allowed" end
  for index = 1, #KEYS, 4 do
    redis.call("SET", KEYS[index + 2], "1")
    redis.call("SET", KEYS[index + 3], argument, "PX", 330000)
  end
  return "probation"
elseif operation == "strike" then
  for index = 1, #KEYS, 4 do
    local window = KEYS[index]
    redis.call("ZREMRANGEBYSCORE", window, "-inf", now - 600000)
    redis.call("ZADD", window, "NX", now, argument)
    redis.call("PEXPIRE", window, 600000)
    if redis.call("ZCARD", window) >= 3 or redis.call("EXISTS", KEYS[index + 3]) == 1 then
      redis.call("SET", KEYS[index + 1], "1", "PX", 3600000)
      redis.call("SET", KEYS[index + 2], "1")
      redis.call("DEL", KEYS[index + 3])
    end
  end
  return "recorded"
elseif operation == "survived" or operation == "release" then
  for index = 1, #KEYS, 4 do
    if redis.call("GET", KEYS[index + 3]) == argument then
      redis.call("DEL", KEYS[index + 3])
      if owned and operation == "survived" then
        redis.call("DEL", KEYS[index], KEYS[index + 2])
      end
    end
  end
  if owned then return "recorded" else return "stale" end
end
return "corrupt"
`;

export class SandboxCrashStore extends Context.Service<SandboxCrashStore>()("SandboxCrashStore", {
	make: Effect.gen(function* () {
		const redis = yield* RedisService;
		const execute = Effect.fn("SandboxCrashStore.execute")(function* (
			identities: ReadonlyArray<string>,
			operation: "acquire" | "strike" | "survived" | "release",
			argument: string,
		) {
			const validated = yield* decodeIdentities(identities).pipe(
				Effect.mapError(() => new SandboxCrashStoreError({ message: "Invalid crash identity" })),
			);
			if (new Set(validated).size !== validated.length || argument.length === 0) {
				return yield* new SandboxCrashStoreError({ message: "Invalid crash ownership" });
			}
			const keys = validated.flatMap((identity) => [
				redisKeys.sandboxCrashWindow(identity),
				redisKeys.sandboxQuarantine(identity),
				redisKeys.sandboxProbation(identity),
				redisKeys.sandboxProbationLease(identity),
			]);
			const result = yield* Effect.tryPromise(() =>
				redis.client.eval(crashScript, keys.length, ...keys, operation, argument),
			).pipe(
				Effect.timeout("2 seconds"),
				Effect.mapError(() => new SandboxCrashStoreError({ message: "Crash store unavailable" })),
			);
			return yield* decodeResponse(result).pipe(
				Effect.mapError(() => new SandboxCrashStoreError({ message: "Crash store is corrupt" })),
			);
		});
		return {
			strike: (identities: ReadonlyArray<string>, event: string) =>
				execute(identities, "strike", event),
			acquire: (identities: ReadonlyArray<string>, owner: string) =>
				execute(identities, "acquire", owner),
			release: (identities: ReadonlyArray<string>, owner: string) =>
				execute(identities, "release", owner),
			survived: (identities: ReadonlyArray<string>, owner: string) =>
				execute(identities, "survived", owner),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
