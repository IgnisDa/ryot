import { expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { workflowReplayJournalEntrySchema } from "@ryot/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";

import { selectSandboxHostFunctions } from "./service";
import type { SandboxRunInput } from "./shared";
import {
	makeWorkflowReplayJournalHostFunction,
	projectWorkflowJournalWithRedis,
} from "./workflow-journal";

const workflowInput: SandboxRunInput = {
	context: {},
	contentHash: "",
	providerId: null,
	compiledCode: "",
	compiledFormat: 1,
	allowedHostFunctions: [],
	scriptId: "workflow-script",
	authority: { type: "system" },
	workflowExecutionId: "parent",
	metadata: { kind: "workflow" },
	executionId: "parent-replay-3",
};

const request = (index: number, name: string, input: JsonValue = { index }) => ({
	name,
	index,
	kind: "activity" as const,
	args: { input, scriptSlug: "activity-script" },
});

const journalEntry = (requestValue: ReturnType<typeof request>, value: unknown) =>
	JSON.stringify({ value, request: requestValue });
const decodeJournalEntry = Schema.decodeUnknownSync(
	Schema.fromJsonString(workflowReplayJournalEntrySchema),
);

const unusedHostFunction = () => Effect.succeed(null);

const makeRedis = (entries: ReadonlyArray<string | null>) => {
	return {
		service: {
			client: {
				hmget: (_key, ..._fields) => Promise.resolve([...entries]),
				hget: (_key, _field) => Promise.resolve(String(entries.length)),
			},
		} satisfies Parameters<typeof makeWorkflowReplayJournalHostFunction>[1],
	};
};

it.effect("returns the full projected journal from one argument-free bootstrap call", () => {
	const first = request(0, "first");
	const second = request(1, "second");
	const redis = makeRedis([
		journalEntry(first, { result: 1 }),
		journalEntry(second, { result: 2 }),
	]);
	const replayJournal = makeWorkflowReplayJournalHostFunction(
		workflowInput.workflowExecutionId,
		redis.service,
	);

	return Effect.gen(function* () {
		expect(yield* replayJournal([])).toEqual({
			success: true,
			data: [
				{ request: first, value: { result: 1 } },
				{ request: second, value: { result: 2 } },
			],
		});
	});
});

it.effect("rejects request-bearing calls instead of retaining the growing-prefix protocol", () => {
	const redis = makeRedis([]);
	const replayJournal = makeWorkflowReplayJournalHostFunction(
		workflowInput.workflowExecutionId,
		redis.service,
	);

	return Effect.gen(function* () {
		expect(yield* replayJournal([[request(0, "old-protocol")]])).toEqual({
			success: false,
			error: "replayJournal does not accept arguments",
		});
	});
});

it.effect("rejects a projection high-water mark above the workflow call limit", () => {
	const client = {
		hmget: () => Promise.reject(new Error("unused")),
		hget: (_key: string, field: string) =>
			Promise.resolve(field === "high-water" ? "1001" : "unused"),
	};
	const replayJournal = makeWorkflowReplayJournalHostFunction("bounded", { client });

	return Effect.gen(function* () {
		expect(yield* replayJournal([])).toEqual({
			success: false,
			error: "Sandbox workflow journal high-water mark is corrupt",
		});
	});
});

it("isolates workflow replay bootstrap from script capabilities", () => {
	const bound = { httpCall: unusedHostFunction, replayJournal: unusedHostFunction };
	expect(
		Object.keys(
			selectSandboxHostFunctions(bound, {
				authority: { type: "system" },
				metadata: { kind: "workflow" },
				allowedHostFunctions: ["httpCall"],
			}),
		),
	).toEqual(["replayJournal"]);
	expect(
		Object.keys(
			selectSandboxHostFunctions(bound, {
				metadata: { kind: "script" },
				authority: { type: "system" },
				allowedHostFunctions: ["replayJournal"],
			}),
		),
	).toEqual([]);
	expect(
		Object.keys(
			selectSandboxHostFunctions(bound, {
				metadata: { kind: "script" },
				authority: { type: "system" },
				allowedHostFunctions: ["httpCall", "replayJournal"],
			}),
		),
	).toEqual(["httpCall"]);
});

it.effect("rebuilds a deleted Redis projection from the durable journal", () => {
	const hashes = new Map<string, Map<string, string>>();
	const client = {
		expire: () => Promise.resolve(1),
		hget: (key: string, field: string) => Promise.resolve(hashes.get(key)?.get(field) ?? null),
		hmget: (key: string, ...fields: string[]) =>
			Promise.resolve(fields.map((field) => hashes.get(key)?.get(field) ?? null)),
		pipeline: () => {
			const writes: Array<() => void> = [];
			return {
				expire: () => undefined,
				exec: () => {
					writes.forEach((write) => write());
					return Promise.resolve([]);
				},
				hset: (key: string, field: string, value: string) =>
					writes.push(() => {
						const fields = hashes.get(key) ?? new Map<string, string>();
						fields.set(field, value);
						hashes.set(key, fields);
					}),
			};
		},
	};
	const journal = [
		{ request: request(0, "first"), value: { result: 1 } },
		{ request: request(1, "second"), value: { result: 2 } },
	];

	return Effect.gen(function* () {
		yield* projectWorkflowJournalWithRedis({ client }, "projection", journal);
		const key = [...hashes.keys()][0];
		expect(key).toBeTruthy();
		hashes.delete(key ?? "");
		yield* projectWorkflowJournalWithRedis({ client }, "projection", journal);
		expect(Array.from(hashes.get(key ?? "")?.keys() ?? []).sort()).toEqual([
			"0",
			"1",
			"high-water",
		]);
	});
});

it.effect("repairs missing and stale projection entries from the authoritative journal", () => {
	const first = request(0, "first");
	const second = request(1, "second");
	const fields = new Map<string, string>([
		["0", journalEntry(first, { result: 1 })],
		["high-water", "1"],
	]);
	const hsetFields: string[] = [];
	let pipelineCalls = 0;
	const client = {
		expire: () => Promise.resolve(1),
		hget: (_key: string, field: string) => Promise.resolve(fields.get(field) ?? null),
		hmget: (_key: string, ...names: string[]) =>
			Promise.resolve(names.map((name) => fields.get(name) ?? null)),
		pipeline: () => {
			pipelineCalls += 1;
			const writes: Array<() => void> = [];
			return {
				expire: () => undefined,
				hset: (_key: string, field: string, value: string) => {
					hsetFields.push(field);
					writes.push(() => fields.set(field, value));
				},
				exec: () => {
					writes.forEach((write) => write());
					return Promise.resolve([]);
				},
			};
		},
	};
	const journal = [
		{ request: first, value: { result: 1 } },
		{ request: second, value: { result: 2 } },
	];

	return Effect.gen(function* () {
		yield* projectWorkflowJournalWithRedis({ client }, "incremental", journal);
		expect(hsetFields.filter((field) => /^\d+$/.test(field))).toEqual(["0", "1"]);
		expect(pipelineCalls).toBe(1);
		expect(fields.get("0")).toBeTruthy();
		expect(fields.get("1")).toBeTruthy();
		expect(fields.get("high-water")).toBe("2");

		yield* projectWorkflowJournalWithRedis({ client }, "incremental", journal);
		expect(pipelineCalls).toBe(1);

		fields.delete("1");
		hsetFields.length = 0;
		yield* projectWorkflowJournalWithRedis({ client }, "incremental", journal);
		expect(hsetFields.filter((field) => /^\d+$/.test(field))).toEqual(["1"]);
		expect(pipelineCalls).toBe(2);

		fields.set("high-water", "invalid");
		fields.delete("0");
		fields.delete("1");
		hsetFields.length = 0;
		yield* projectWorkflowJournalWithRedis({ client }, "incremental", journal);
		expect(hsetFields.filter((field) => /^\d+$/.test(field))).toEqual(["0", "1"]);
		expect(fields.get("high-water")).toBe("2");
	});
});

it.effect("hides an ahead projection until durable memos rebuild the journal after restart", () => {
	const first = request(0, "first");
	const second = request(1, "second");
	const firstEntry = journalEntry(first, { result: 1 });
	const secondEntry = journalEntry(second, { result: 2 });
	const fields = new Map<string, string>([
		["0", firstEntry],
		["1", secondEntry],
		["high-water", "2"],
	]);
	let hmgetCalls = 0;
	const client = {
		expire: () => Promise.resolve(1),
		hget: (_key: string, field: string) => Promise.resolve(fields.get(field) ?? null),
		hmget: (_key: string, ...names: string[]) => {
			hmgetCalls += 1;
			return Promise.resolve(names.map((name) => fields.get(name) ?? null));
		},
		pipeline: () => {
			const writes: Array<() => void> = [];
			return {
				expire: () => undefined,
				hset: (_key: string, field: string, value: string) =>
					writes.push(() => fields.set(field, value)),
				exec: () => {
					writes.forEach((write) => write());
					return Promise.resolve([]);
				},
				hsetnx: (_key: string, field: string, value: string) =>
					writes.push(() => {
						if (!fields.has(field)) {
							fields.set(field, value);
						}
					}),
			};
		},
	};
	const replayJournal = makeWorkflowReplayJournalHostFunction("reconstructed", { client });
	const rebuiltJournal = [
		{ request: first, value: { result: 1 } },
		{ request: second, value: { result: 2 } },
	];

	return Effect.gen(function* () {
		yield* projectWorkflowJournalWithRedis({ client }, "reconstructed", []);
		expect(fields.get("high-water")).toBe("0");
		expect(yield* replayJournal([])).toEqual({ success: true, data: [] });
		expect(hmgetCalls).toBe(0);

		yield* projectWorkflowJournalWithRedis({ client }, "reconstructed", rebuiltJournal.slice(0, 1));
		expect(yield* replayJournal([])).toEqual({
			success: true,
			data: [{ request: first, value: { result: 1 } }],
		});
		expect(hmgetCalls).toBe(2);

		yield* projectWorkflowJournalWithRedis({ client }, "reconstructed", rebuiltJournal);
		expect(yield* replayJournal([])).toEqual({
			success: true,
			data: [
				{ request: first, value: { result: 1 } },
				{ request: second, value: { result: 2 } },
			],
		});
		expect(hmgetCalls).toBe(4);
		expect(decodeJournalEntry(fields.get("0") ?? "")).toEqual({
			request: first,
			value: { result: 1 },
		});
		expect(decodeJournalEntry(fields.get("1") ?? "")).toEqual({
			request: second,
			value: { result: 2 },
		});
	});
});
