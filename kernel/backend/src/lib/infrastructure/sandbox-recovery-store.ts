import { Context, Effect, Layer, Schema } from "effect";

import { redisKeys, RedisService } from "./redis";

export class SandboxRecoveryStoreError extends Schema.TaggedError<SandboxRecoveryStoreError>()(
	"SandboxRecoveryStoreError",
	{ message: Schema.String },
) {}

const recoveryStateSchema = Schema.Struct({
	suspended: Schema.Boolean,
	recoveries: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
});
const decodeRecoveryState = Schema.decodeUnknownEffect(Schema.fromJsonString(recoveryStateSchema));
const nonEmptyStringSchema = Schema.String.check(Schema.isNonEmpty());
export const SandboxRecoveryIdentity = Schema.Struct({
	instance: nonEmptyStringSchema,
	executionId: nonEmptyStringSchema,
	pinHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
});
export type SandboxRecoveryIdentity = typeof SandboxRecoveryIdentity.Type;
const decodeIdentity = Schema.decodeUnknownEffect(SandboxRecoveryIdentity);
const decodeNonEmptyString = Schema.decodeUnknownEffect(nonEmptyStringSchema);

const recoveryScript = `
local operation = ARGV[1]
local instance = ARGV[2]
local pin_hash = ARGV[3]
local argument = ARGV[4]
local function encode_state(recoveries, suspended)
  return cjson.encode({ recoveries = recoveries, suspended = suspended })
end
local key_type = redis.call("TYPE", KEYS[1]).ok
if key_type ~= "none" and key_type ~= "hash" then return "corrupt" end
if key_type == "none" then
  if operation == "clear" then return encode_state(0, false) end
  redis.call("HSET", KEYS[1], "instance", instance, "pinHash", pin_hash, "recoveries", "0", "suspended", "0")
end
local values = redis.call("HGETALL", KEYS[1])
local row = {}
local allowed = {
  instance = true,
  pinHash = true,
  recoveries = true,
  suspended = true,
  event1 = true,
  event2 = true,
  event3 = true,
  latestSuspendedEvent = true,
  healthyEpoch = true
}
for index = 1, #values, 2 do
  local field = values[index]
  if not allowed[field] or row[field] ~= nil then return "corrupt" end
  row[field] = values[index + 1]
end
if not row.instance or row.instance == "" or not row.pinHash or string.len(row.pinHash) ~= 64 or string.match(row.pinHash, "^[0-9a-f]+$") == nil then
  return "corrupt"
end
if not row.recoveries or string.match(row.recoveries, "^[0-3]$") == nil or (row.suspended ~= "0" and row.suspended ~= "1") then
  return "corrupt"
end
local recoveries = tonumber(row.recoveries)
local suspended = row.suspended == "1"
for index = 1, 3 do
  local event = row["event" .. index]
  if index <= recoveries then
    if not event or event == "" then return "corrupt" end
    for previous = 1, index - 1 do
      if event == row["event" .. previous] then return "corrupt" end
    end
  elseif event ~= nil then
    return "corrupt"
  end
end
if row.latestSuspendedEvent ~= nil then
  if recoveries ~= 3 or row.latestSuspendedEvent == "" then return "corrupt" end
  for index = 1, 3 do
    if row.latestSuspendedEvent == row["event" .. index] then return "corrupt" end
  end
elseif suspended then
  return "corrupt"
end
if row.healthyEpoch ~= nil and row.healthyEpoch == "" then return "corrupt" end
if row.instance ~= instance or row.pinHash ~= pin_hash then return "identity-mismatch" end
if operation == "clear" then
  redis.call("DEL", KEYS[1])
  return encode_state(0, false)
elseif operation == "collateral" then
  local duplicate = row.latestSuspendedEvent == argument
  for index = 1, recoveries do
    if row["event" .. index] == argument then duplicate = true end
  end
  if not duplicate then
    if recoveries < 3 then
      recoveries = recoveries + 1
      redis.call("HSET", KEYS[1], "recoveries", tostring(recoveries), "event" .. recoveries, argument)
    else
      redis.call("HSET", KEYS[1], "suspended", "1", "latestSuspendedEvent", argument)
      suspended = true
    end
  end
  return encode_state(recoveries, suspended)
elseif operation == "resume" then
  if row.healthyEpoch ~= argument then
    redis.call("HSET", KEYS[1], "healthyEpoch", argument)
    if suspended then
      redis.call("HSET", KEYS[1], "suspended", "0")
      suspended = false
    end
  end
  return encode_state(recoveries, suspended)
end
return encode_state(recoveries, suspended)
`;

export class SandboxRecoveryStore extends Context.Service<SandboxRecoveryStore>()(
	"SandboxRecoveryStore",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const execute = Effect.fn("SandboxRecoveryStore.execute")(function* (
				operation: "read" | "collateral" | "resume" | "clear",
				input: SandboxRecoveryIdentity,
				argument?: string,
			) {
				const identity = yield* decodeIdentity(input).pipe(
					Effect.mapError(
						() => new SandboxRecoveryStoreError({ message: "Invalid recovery identity" }),
					),
				);
				const validatedArgument =
					operation === "collateral" || operation === "resume"
						? yield* decodeNonEmptyString(argument).pipe(
								Effect.mapError(
									() =>
										new SandboxRecoveryStoreError({
											message: `Invalid recovery ${operation === "collateral" ? "event" : "epoch"}`,
										}),
								),
							)
						: undefined;
				const args =
					validatedArgument === undefined
						? [operation, identity.instance, identity.pinHash]
						: [operation, identity.instance, identity.pinHash, validatedArgument];
				const result = yield* Effect.tryPromise(() =>
					redis.client.eval(
						recoveryScript,
						1,
						redisKeys.sandboxRecovery(identity.executionId),
						...args,
					),
				).pipe(
					Effect.timeout("2 seconds"),
					Effect.mapError(
						() => new SandboxRecoveryStoreError({ message: "Recovery store unavailable" }),
					),
				);
				if (result === "identity-mismatch") {
					return yield* new SandboxRecoveryStoreError({ message: "Recovery identity mismatch" });
				}
				return yield* decodeRecoveryState(result).pipe(
					Effect.mapError(
						() => new SandboxRecoveryStoreError({ message: "Recovery store is corrupt" }),
					),
				);
			});
			return {
				read: (identity: SandboxRecoveryIdentity) => execute("read", identity),
				clear: (identity: SandboxRecoveryIdentity) => execute("clear", identity),
				collateral: (identity: SandboxRecoveryIdentity, eventId: string) =>
					execute("collateral", identity, eventId),
				resume: (identity: SandboxRecoveryIdentity, healthyEpoch: string) =>
					execute("resume", identity, healthyEpoch),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
