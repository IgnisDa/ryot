import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import { Effect, Schema } from "effect";

import { redisKeys, type RedisService } from "./redis";
import { SANDBOX_LIMITS } from "./sandbox-runtime/limits";

type JournalRedis = { readonly client: Pick<RedisService["Service"]["client"], "eval"> };

const entryLength = Schema.Int.check(
	Schema.isBetween({ minimum: 0, maximum: SANDBOX_LIMITS.journalBytes }),
);
const entryPin = Schema.Tuple([
	entryLength,
	Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
]);
const entryPins = Schema.Array(entryPin).check(Schema.isMaxLength(SANDBOX_LIMITS.hostCalls.total));

const SandboxJournalInspection = Schema.Struct({
	entries: entryPins,
	bytes: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: SANDBOX_LIMITS.journalBytes })),
});
export type SandboxJournalInspection = typeof SandboxJournalInspection.Type;

const journalResponse = Schema.Union([
	Schema.Tuple([Schema.Literal("missing")]),
	Schema.Tuple([Schema.Literal("changed")]),
	Schema.Tuple([Schema.Literal("oversized")]),
	Schema.Tuple([Schema.Literal("inspected"), entryPins]),
	Schema.Tuple([
		Schema.Literal("read"),
		Schema.Array(Schema.String).check(Schema.isMaxLength(SANDBOX_LIMITS.hostCalls.total)),
	]),
]);

const journalScript = `
local count = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local operation = ARGV[3]
local total = 2 + math.max(0, count - 1)
local lengths = {}
for index = 0, count - 1 do
  local field = tostring(index)
  if redis.call('HEXISTS', KEYS[1], field) == 0 then
    return { 'missing' }
  end
  local length = redis.call('HSTRLEN', KEYS[1], field)
  total = total + length
  lengths[index + 1] = length
end
if total > limit then
  return { 'oversized' }
end

local entries = {}
for index = 0, count - 1 do
  local value = redis.call('HGET', KEYS[1], tostring(index))
  local digest = redis.sha1hex(value)
  local length = lengths[index + 1]
  if operation == 'inspect' then
    entries[index + 1] = { length, digest }
  else
    if length ~= tonumber(ARGV[4 + 2 * index]) or digest ~= ARGV[5 + 2 * index] then
      return { 'changed' }
    end
    entries[index + 1] = value
  end
end
return { operation == 'inspect' and 'inspected' or 'read', entries }
`;

const journalFailure = (message: string) =>
	new SandboxRunError({ message, kind: "infrastructure" });

const execute = Effect.fnUntraced(function* (
	redis: JournalRedis,
	executionId: string,
	journalLength: number,
	operation: "inspect" | "read",
	entries: SandboxJournalInspection["entries"] = [],
) {
	if (
		!Number.isSafeInteger(journalLength) ||
		journalLength < 0 ||
		journalLength > SANDBOX_LIMITS.hostCalls.total
	) {
		return yield* journalFailure("Sandbox workflow journal length is invalid");
	}
	const response = yield* Effect.tryPromise({
		catch: (error) =>
			journalFailure(`Sandbox workflow journal command failed: ${unknownToMessage(error)}`),
		try: () =>
			redis.client.eval(
				journalScript,
				1,
				redisKeys.sandboxWorkflowJournal(executionId),
				String(journalLength),
				String(SANDBOX_LIMITS.journalBytes),
				operation,
				...entries.flatMap(([bytes, digest]) => [String(bytes), digest]),
			),
	});
	return yield* Schema.decodeUnknownEffect(journalResponse)(response).pipe(
		Effect.mapError(() => journalFailure("Sandbox workflow journal response is invalid")),
	);
});

export const inspectSandboxJournal = Effect.fn("inspectSandboxJournal")(function* (
	redis: JournalRedis,
	executionId: string,
	journalLength: number,
) {
	if (journalLength === 0) {
		return { bytes: 2, entries: [] };
	}
	const response = yield* execute(redis, executionId, journalLength, "inspect");
	if (response[0] === "missing") {
		return null;
	}
	if (response[0] === "oversized") {
		return yield* journalFailure("Sandbox workflow journal projection exceeds its byte limit");
	}
	if (response[0] !== "inspected" || response[1].length !== journalLength) {
		return yield* journalFailure("Sandbox workflow journal inspection is invalid");
	}
	return {
		entries: response[1],
		bytes:
			2 + Math.max(0, journalLength - 1) + response[1].reduce((sum, [bytes]) => sum + bytes, 0),
	};
});

export const readEncodedSandboxJournal = Effect.fn("readEncodedSandboxJournal")(function* (
	redis: JournalRedis,
	executionId: string,
	inspection: SandboxJournalInspection,
) {
	if (inspection.entries.length === 0) {
		return [];
	}
	const response = yield* execute(
		redis,
		executionId,
		inspection.entries.length,
		"read",
		inspection.entries,
	);
	if (response[0] === "missing") {
		return null;
	}
	if (response[0] === "changed" || response[0] === "oversized") {
		return yield* journalFailure("Sandbox workflow journal changed after inspection");
	}
	if (response[0] !== "read" || response[1].length !== inspection.entries.length) {
		return yield* journalFailure("Sandbox workflow journal read is invalid");
	}
	return response[1];
});
