import { Context, Effect, Layer, Schema } from "effect";

import { SandboxRedis, sandboxRedisKeys } from "./redis";

export class SandboxCrashStoreError extends Schema.TaggedError<
	SandboxCrashStoreError,
	{ readonly brand: unique symbol }
>()("SandboxCrashStoreError", { message: Schema.String }) {}

const responseSchema = Schema.Literals(["allowed", "probation", "blocked", "recorded", "stale"]);
const decodeResponse = Schema.decodeUnknownEffect(responseSchema);
const identitySchema = Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(
	Schema.isMinLength(1),
	Schema.isMaxLength(2),
);
const decodeIdentities = Schema.decodeUnknownEffect(identitySchema);

const PROBATION_LEASE_MS = 330_000;
export const CRASH_WINDOW_MS = 600_000;
export const QUARANTINE_MS = 3_600_000;
const CRASH_STRIKE_LIMIT = 3;

export const sandboxProtectionKeys = (identity: string) => [
	sandboxRedisKeys.crashWindow(identity),
	sandboxRedisKeys.quarantine(identity),
	sandboxRedisKeys.probation(identity),
	sandboxRedisKeys.probationLease(identity),
];

const crashScript = `
local operation = ARGV[1]
local argument = ARGV[2]
local now_parts = redis.call("TIME")
local now = tonumber(now_parts[1]) * 1000 + math.floor(tonumber(now_parts[2]) / 1000)
local probation = false
local owned = true
for index = 1, #KEYS, 4 do
  local blocked = redis.call("GET", KEYS[index + 1])
  local required = redis.call("GET", KEYS[index + 2])
  local lease = redis.call("GET", KEYS[index + 3])
  if operation == "acquire" and (blocked or lease) then return "blocked" end
  if required then probation = true end
  if lease ~= argument then owned = false end
end
if operation == "acquire" then
  if not probation then return "allowed" end
  for index = 1, #KEYS, 4 do
    redis.call("SET", KEYS[index + 2], "1")
    redis.call("SET", KEYS[index + 3], argument, "PX", ${PROBATION_LEASE_MS})
  end
  return "probation"
elseif operation == "strike" then
  for index = 1, #KEYS, 4 do
    local window = KEYS[index]
    redis.call("ZREMRANGEBYSCORE", window, "-inf", now - ${CRASH_WINDOW_MS})
    redis.call("ZADD", window, "NX", now, argument)
    redis.call("PEXPIRE", window, ${CRASH_WINDOW_MS})
    if redis.call("ZCARD", window) >= ${CRASH_STRIKE_LIMIT} or redis.call("EXISTS", KEYS[index + 3]) == 1 then
      redis.call("SET", KEYS[index + 1], "1", "PX", ${QUARANTINE_MS})
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
`;

export class SandboxCrashStore extends Context.Service<SandboxCrashStore>()("SandboxCrashStore", {
	make: Effect.gen(function* () {
		const redis = yield* SandboxRedis;
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
			const keys = validated.flatMap(sandboxProtectionKeys);
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
