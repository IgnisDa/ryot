import { unknownToMessage } from "@ryot/contract/errors";
import { Context, Effect, Layer, Schema } from "effect";

import { redisKeys, RedisService } from "./redis";

const MINIMUM_TTL_MS = 60_000;
const COMMAND_TIMEOUT_MS = 2_000;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isNonEmpty()));
const SafeTimestamp = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const PositiveSafeInteger = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)));
const SafeInterval = PositiveSafeInteger.pipe(
	Schema.check(Schema.isLessThanOrEqualTo(Math.floor(MAX_SAFE_INTEGER / 10))),
);

export const ProviderHttpAdmissionDeclaration = Schema.Struct({
	key: NonEmptyString,
	hash: NonEmptyString,
	intervalMs: SafeInterval,
	requests: PositiveSafeInteger,
});
export type ProviderHttpAdmissionDeclaration = typeof ProviderHttpAdmissionDeclaration.Type;

export const ProviderHttpAdmissionToken = Schema.Struct({
	eligibleAtMs: SafeTimestamp,
	observedAtMs: SafeTimestamp,
	declarationHash: NonEmptyString,
});
export type ProviderHttpAdmissionToken = typeof ProviderHttpAdmissionToken.Type;

export const ProviderHttpAdmissionConfirmation = Schema.Union([
	Schema.Struct({ status: Schema.Literal("stale") }),
	Schema.Struct({ status: Schema.Literal("admitted") }),
	Schema.Struct({
		eligibleAtMs: SafeTimestamp,
		observedAtMs: SafeTimestamp,
		status: Schema.Literal("later"),
	}),
]);
export type ProviderHttpAdmissionConfirmation = typeof ProviderHttpAdmissionConfirmation.Type;

export const ProviderHttpAdmissionBlockResult = Schema.Union([
	Schema.Struct({ status: Schema.Literal("stale") }),
	Schema.Struct({
		observedAtMs: SafeTimestamp,
		blockedUntilMs: SafeTimestamp,
		status: Schema.Literal("blocked"),
	}),
]);
export type ProviderHttpAdmissionBlockResult = typeof ProviderHttpAdmissionBlockResult.Type;

export class ProviderHttpAdmissionUnavailable extends Schema.TaggedError<ProviderHttpAdmissionUnavailable>()(
	"ProviderHttpAdmissionUnavailable",
	{ message: Schema.String },
) {}

export class ProviderHttpAdmissionCorruptState extends Schema.TaggedError<ProviderHttpAdmissionCorruptState>()(
	"ProviderHttpAdmissionCorruptState",
	{ message: Schema.String },
) {}

const AdmissionResponse = Schema.Union([
	Schema.Tuple([Schema.Literal("stale")]),
	Schema.Tuple([Schema.Literal("corrupt")]),
	Schema.Tuple([Schema.Literal("admitted")]),
	Schema.Tuple([Schema.Literal("later"), Schema.String, Schema.String]),
	Schema.Tuple([Schema.Literal("blocked"), Schema.String, Schema.String]),
	Schema.Tuple([Schema.Literal("reserved"), Schema.String, Schema.String, Schema.String]),
]);

const admissionScript = `
local MAX_SAFE_INTEGER = 9007199254740991

local function parse_non_negative_integer(value)
  if not value or not string.match(value, "^%d+$") then
    return nil
  end
  local parsed = tonumber(value)
  if not parsed or parsed < 0 or parsed > MAX_SAFE_INTEGER or parsed % 1 ~= 0 then
    return nil
  end
  return parsed
end

local function parse_positive_integer(value)
  local parsed = parse_non_negative_integer(value)
  if not parsed or parsed == 0 then
    return nil
  end
  return parsed
end

local function format_integer(value)
  return string.format("%.0f", value)
end

local time = redis.call("TIME")
local seconds = parse_non_negative_integer(time[1])
local microseconds = parse_non_negative_integer(time[2])
if not seconds or not microseconds or microseconds >= 1000000 then
  return { "corrupt" }
end
local now = seconds * 1000 + math.floor(microseconds / 1000)
local observed_at = format_integer(now)

local raw = redis.pcall("HGETALL", KEYS[1])
if raw.err then
  return { "corrupt" }
end

local state = nil
if #raw > 0 then
  if #raw ~= 6 then
    return { "corrupt" }
  end
  state = {}
  for index = 1, #raw, 2 do
    local field = raw[index]
    if (field ~= "h" and field ~= "n" and field ~= "b") or state[field] ~= nil then
      return { "corrupt" }
    end
    state[field] = raw[index + 1]
  end
  if not state.h or state.h == "" then
    return { "corrupt" }
  end
  state.n = parse_non_negative_integer(state.n)
  state.b = parse_non_negative_integer(state.b)
  if not state.n or not state.b then
    return { "corrupt" }
  end
end

local operation = ARGV[1]
local declaration_hash = ARGV[2]
local value = parse_non_negative_integer(ARGV[3])
local base_ttl = parse_positive_integer(ARGV[4])
if not operation or not declaration_hash or declaration_hash == "" or not value or not base_ttl then
  return { "corrupt" }
end

local function expiry_ttl(blocked_until)
  local ttl = base_ttl
  if blocked_until > now then
    ttl = ttl + blocked_until - now
  end
  if ttl > MAX_SAFE_INTEGER then
    return nil
  end
  return ttl
end

if operation == "reserve" then
  if value == 0 then
    return { "corrupt" }
  end
  local blocked_until = state and state.b or 0
  local next_eligible = now
  if state and state.h == declaration_hash then
    next_eligible = state.n
  end
  local eligible = math.max(now, next_eligible, blocked_until)
  local ttl = expiry_ttl(blocked_until)
  if eligible > MAX_SAFE_INTEGER - value or not ttl then
    return { "corrupt" }
  end
  redis.call(
    "HSET",
    KEYS[1],
    "h", declaration_hash,
    "n", format_integer(eligible + value),
    "b", format_integer(blocked_until)
  )
  redis.call("PEXPIRE", KEYS[1], ttl)
  return { "reserved", format_integer(eligible), declaration_hash, observed_at }
end

if not state or state.h ~= declaration_hash then
  return { "stale" }
end

if operation == "confirm" then
  local eligible = math.max(value, state.b)
  local ttl = expiry_ttl(state.b)
  if not ttl then
    return { "corrupt" }
  end
  redis.call("PEXPIRE", KEYS[1], ttl)
  if eligible > now then
    return { "later", format_integer(eligible), observed_at }
  end
  return { "admitted" }
end

if operation == "block" then
  local blocked_until = math.max(value, state.b)
  local ttl = expiry_ttl(blocked_until)
  if not ttl then
    return { "corrupt" }
  end
  redis.call("HSET", KEYS[1], "b", format_integer(blocked_until))
  redis.call("PEXPIRE", KEYS[1], ttl)
  return { "blocked", format_integer(blocked_until), observed_at }
end

return { "corrupt" }
`;

const corruptState = (message: string) => new ProviderHttpAdmissionCorruptState({ message });

const parseTimestamp = (value: string, operation: string) => {
	if (!/^\d+$/.test(value)) {
		return Effect.fail(corruptState(`Redis returned an invalid ${operation} timestamp`));
	}
	const timestamp = Number(value);
	return Number.isSafeInteger(timestamp)
		? Effect.succeed(timestamp)
		: Effect.fail(corruptState(`Redis returned an invalid ${operation} timestamp`));
};

const validateDeclaration = (declaration: ProviderHttpAdmissionDeclaration) =>
	declaration.key.length > 0 &&
	declaration.hash.length > 0 &&
	Number.isSafeInteger(declaration.requests) &&
	declaration.requests > 0 &&
	Number.isSafeInteger(declaration.intervalMs) &&
	declaration.intervalMs > 0 &&
	declaration.intervalMs <= Math.floor(MAX_SAFE_INTEGER / 10)
		? Effect.succeed({
				spacingMs: Math.ceil(declaration.intervalMs / declaration.requests),
				ttlMs: Math.max(10 * declaration.intervalMs, MINIMUM_TTL_MS),
			})
		: Effect.fail(corruptState("Provider HTTP admission declaration is invalid"));

const decodeResponse = (value: unknown) =>
	Schema.decodeUnknownEffect(AdmissionResponse)(value).pipe(
		Effect.mapError(() => corruptState("Redis returned an invalid admission response")),
	);

export class ProviderHttpAdmissionService extends Context.Service<ProviderHttpAdmissionService>()(
	"ProviderHttpAdmissionService",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;

			const execute = (
				declaration: ProviderHttpAdmissionDeclaration,
				operation: string,
				value: number,
				declarationHash = declaration.hash,
			) =>
				Effect.gen(function* () {
					const { spacingMs, ttlMs } = yield* validateDeclaration(declaration);
					const operationValue = operation === "reserve" ? spacingMs : value;
					const response = yield* Effect.tryPromise({
						try: () =>
							redis.client.eval(
								admissionScript,
								1,
								redisKeys.providerHttpAdmission(declaration.key),
								operation,
								declarationHash,
								String(operationValue),
								String(ttlMs),
							),
						catch: (error) =>
							new ProviderHttpAdmissionUnavailable({
								message: `Redis admission command failed: ${unknownToMessage(error)}`,
							}),
					}).pipe(
						Effect.timeoutOrElse({
							duration: COMMAND_TIMEOUT_MS,
							orElse: () =>
								Effect.fail(
									new ProviderHttpAdmissionUnavailable({
										message: "Redis admission command timed out",
									}),
								),
						}),
					);
					return yield* decodeResponse(response);
				});

			const reserve = Effect.fn("ProviderHttpAdmissionService.reserve")(function* (
				declaration: ProviderHttpAdmissionDeclaration,
			) {
				const response = yield* execute(declaration, "reserve", 0);
				if (response[0] === "corrupt") {
					return yield* corruptState("Redis admission state is corrupt");
				}
				if (response[0] !== "reserved") {
					return yield* corruptState("Redis returned an unexpected reservation response");
				}
				if (response[2] !== declaration.hash) {
					return yield* corruptState("Redis returned a mismatched declaration hash");
				}
				const eligibleAtMs = yield* parseTimestamp(response[1], "reservation");
				const observedAtMs = yield* parseTimestamp(response[3], "observation");
				return { eligibleAtMs, observedAtMs, declarationHash: response[2] };
			});

			const confirm = Effect.fn("ProviderHttpAdmissionService.confirm")(function* (
				declaration: ProviderHttpAdmissionDeclaration,
				token: ProviderHttpAdmissionToken,
			) {
				const response = yield* execute(
					declaration,
					"confirm",
					token.eligibleAtMs,
					token.declarationHash,
				);
				if (response[0] === "corrupt") {
					return yield* corruptState("Redis admission state is corrupt");
				}
				if (response[0] === "admitted" || response[0] === "stale") {
					return { status: response[0] };
				}
				if (response[0] !== "later") {
					return yield* corruptState("Redis returned an unexpected confirmation response");
				}
				return {
					status: "later" as const,
					eligibleAtMs: yield* parseTimestamp(response[1], "confirmation"),
					observedAtMs: yield* parseTimestamp(response[2], "observation"),
				};
			});

			const block = Effect.fn("ProviderHttpAdmissionService.block")(function* (
				declaration: ProviderHttpAdmissionDeclaration,
				blockedUntilMs: number,
			) {
				if (!Number.isSafeInteger(blockedUntilMs) || blockedUntilMs < 0) {
					return yield* corruptState("Provider HTTP admission blocked-until is invalid");
				}
				const response = yield* execute(declaration, "block", blockedUntilMs);
				if (response[0] === "corrupt") {
					return yield* corruptState("Redis admission state is corrupt");
				}
				if (response[0] === "stale") {
					return { status: "stale" as const };
				}
				if (response[0] !== "blocked") {
					return yield* corruptState("Redis returned an unexpected block response");
				}
				return {
					status: "blocked" as const,
					blockedUntilMs: yield* parseTimestamp(response[1], "block"),
					observedAtMs: yield* parseTimestamp(response[2], "observation"),
				};
			});

			return { block, confirm, reserve };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
