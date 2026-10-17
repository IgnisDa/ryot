import { Context, Effect, Layer, Schema } from "effect";

import { SandboxRedis, sandboxRedisKeys } from "./redis";

export class SandboxRecoveryStoreError extends Schema.TaggedError<
	SandboxRecoveryStoreError,
	{ readonly brand: unique symbol }
>()("SandboxRecoveryStoreError", { message: Schema.String }) {}

const RECOVERY_LIMIT = 3;

const recoveryStateSchema = Schema.Struct({
	suspended: Schema.Boolean,
	recoveries: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: RECOVERY_LIMIT })),
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
if redis.call("EXISTS", KEYS[1]) == 0 then
  if operation == "clear" then return encode_state(0, false) end
  redis.call("HSET", KEYS[1], "instance", instance, "pinHash", pin_hash, "recoveries", "0", "suspended", "0")
end
local values = redis.call("HGETALL", KEYS[1])
local row = {}
for index = 1, #values, 2 do
  row[values[index]] = values[index + 1]
end
local recoveries = tonumber(row.recoveries)
local suspended = row.suspended == "1"
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
    if recoveries < ${RECOVERY_LIMIT} then
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
			const redis = yield* SandboxRedis;
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
						sandboxRedisKeys.recovery(identity.executionId),
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
