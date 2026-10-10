import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import {
	chunkSandboxJournalEntry,
	SANDBOX_JOURNAL_CHUNK_BYTES,
	type SandboxJournalFault,
	type SandboxJournalInspection,
	type SandboxJournalPin,
	SandboxJournalPins,
	type SandboxPinnedJournal,
} from "@ryot-app/sandbox/host/pinned-journal";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { Effect, Schema } from "effect";

import { redisKeys, type RedisService } from "#platform/redis";

type JournalRedis = {
	readonly client: Pick<RedisService["Service"]["client"], "callBuffer" | "eval">;
};

const projectionTtlSeconds = 24 * 60 * 60;
const inspectResponse = Schema.Union([
	Schema.Tuple([Schema.Literal("missing")]),
	Schema.Tuple([Schema.Literal("invalid")]),
	Schema.Tuple([Schema.Literal("oversized")]),
	Schema.Tuple([Schema.Literal("inspected"), SandboxJournalPins]),
]);
const missingChunk = 0;
const changedChunk = 1;
const chunkResponse = Schema.Union([
	Schema.Literal(missingChunk),
	Schema.Literal(changedChunk),
	Schema.Uint8Array,
]);

const appendScript = `
local firstIndex = tonumber(ARGV[2])
local entries = {}
local position = 3
while position <= #ARGV do
  local meta = ARGV[position]
  local chunks = tonumber(string.match(meta, '^%d+:(%d+):'))
  local index = firstIndex + #entries
  local existing = redis.call('HGET', KEYS[1], 'm:' .. index)
  if existing ~= false and existing ~= meta then
    return redis.error_reply('journal-divergence:' .. index)
  end
  entries[#entries + 1] = { index, meta, position + 1, chunks, existing == false }
  position = position + 1 + chunks
end
for _, entry in ipairs(entries) do
  if entry[5] then
    for chunk = 0, entry[4] - 1 do
      redis.call('HSET', KEYS[1], 'c:' .. entry[1] .. ':' .. chunk, ARGV[entry[3] + chunk])
    end
    redis.call('HSET', KEYS[1], 'm:' .. entry[1], entry[2])
  end
end
return redis.call('EXPIRE', KEYS[1], ARGV[1])
`;

const inspectScript = `
local count = tonumber(ARGV[1])
local total = 2 + math.max(0, count - 1)
local metas = {}
for index = 0, count - 1 do
  metas[index + 1] = redis.call('HGET', KEYS[1], 'm:' .. index)
  if metas[index + 1] == false then
    return { 'missing' }
  end
end
local entries = {}
for index = 0, count - 1 do
  local bytes, chunks, digest = string.match(metas[index + 1], '^(%d+):(%d+):(%x+)$')
  if bytes == nil then
    return { 'invalid' }
  end
  total = total + tonumber(bytes)
  if total > tonumber(ARGV[2]) then
    return { 'oversized' }
  end
  entries[index + 1] = { tonumber(bytes), tonumber(chunks), digest }
end
return { 'inspected', entries }
`;

const readChunkScript = `
local meta = redis.call('HGET', KEYS[1], 'm:' .. ARGV[1])
if meta == false then
  return ${missingChunk}
end
if meta ~= ARGV[3] then
  return ${changedChunk}
end
local chunk = redis.call('HGET', KEYS[1], 'c:' .. ARGV[1] .. ':' .. ARGV[2])
if chunk == false then
  return ${missingChunk}
end
if string.len(chunk) ~= tonumber(ARGV[4]) then
  return ${changedChunk}
end
return chunk
`;

const divergencePattern = /journal-divergence:(\d+)/;

const journalFailure = (message: string) =>
	new SandboxRunError({ message, kind: "infrastructure" });

const encodePin = ([bytes, chunks, digest]: SandboxJournalPin) => `${bytes}:${chunks}:${digest}`;

export const appendSandboxJournal = Effect.fn("appendSandboxJournal")(function* (
	redis: JournalRedis,
	executionId: string,
	firstIndex: number,
	texts: ReadonlyArray<string>,
) {
	if (texts.length === 0) {
		return;
	}
	yield* Effect.tryPromise({
		catch: unknownToMessage,
		try: () =>
			redis.client.callBuffer(
				"EVAL",
				appendScript,
				"1",
				redisKeys.sandboxWorkflowJournal(executionId),
				String(projectionTtlSeconds),
				String(firstIndex),
				...texts.flatMap((text) => {
					const { pin, chunks } = chunkSandboxJournalEntry(text);
					return [
						encodePin(pin),
						...chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
					];
				}),
			),
	}).pipe(
		Effect.catch((message) => {
			const divergence = divergencePattern.exec(message);
			return divergence
				? Effect.fail(
						journalFailure(
							`Sandbox workflow journal[${divergence[1]}] diverged from its projected entry`,
						),
					)
				: Effect.die(message);
		}),
	);
});

export const inspectSandboxJournal = Effect.fn("inspectSandboxJournal")(function* (
	redis: JournalRedis,
	executionId: string,
	journalLength: number,
) {
	if (
		!Number.isSafeInteger(journalLength) ||
		journalLength < 0 ||
		journalLength > SANDBOX_LIMITS.hostCalls.total
	) {
		return yield* journalFailure("Sandbox workflow journal length is invalid");
	}
	if (journalLength === 0) {
		return { bytes: 2, entries: [] };
	}
	const raw = yield* Effect.tryPromise({
		catch: (error) =>
			journalFailure(`Sandbox workflow journal command failed: ${unknownToMessage(error)}`),
		try: () =>
			redis.client.eval(
				inspectScript,
				1,
				redisKeys.sandboxWorkflowJournal(executionId),
				String(journalLength),
				String(SANDBOX_LIMITS.journalBytes),
			),
	});
	const response = yield* Schema.decodeUnknownEffect(inspectResponse)(raw).pipe(
		Effect.mapError(() => journalFailure("Sandbox workflow journal inspection is invalid")),
	);
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

export const pinSandboxJournal = (
	redis: JournalRedis,
	executionId: string,
	inspection: SandboxJournalInspection,
): SandboxPinnedJournal => {
	let fault: SandboxJournalFault | undefined;
	const fail = (next: SandboxJournalFault) =>
		Effect.sync(() => {
			fault ??= next;
			return null;
		});
	const readChunk = (index: number, chunk: number) => {
		const pin = inspection.entries[index];
		if (fault !== undefined || pin === undefined || chunk < 0 || chunk >= pin[1]) {
			return fail("failed");
		}
		return Effect.tryPromise(() =>
			redis.client.callBuffer(
				"EVAL",
				readChunkScript,
				"1",
				redisKeys.sandboxWorkflowJournal(executionId),
				String(index),
				String(chunk),
				encodePin(pin),
				String(Math.min(SANDBOX_JOURNAL_CHUNK_BYTES, pin[0] - chunk * SANDBOX_JOURNAL_CHUNK_BYTES)),
			),
		).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(chunkResponse)),
			Effect.matchEffect({
				onFailure: () => fail("failed"),
				onSuccess: (response) => {
					if (response === missingChunk) {
						return fail("missing");
					}
					return response === changedChunk ? fail("changed") : Effect.succeed(response);
				},
			}),
			// ioredis cannot abort an in-flight command; its reply stays charged until it lands.
			Effect.uninterruptible,
		);
	};
	return { ...inspection, readChunk, fault: () => fault };
};
