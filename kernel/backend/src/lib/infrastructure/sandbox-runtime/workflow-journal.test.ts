import { expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
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
	compiledCode: "",
	compiledFormat: 1,
	workflowExecutionId: "parent",
	executionId: "parent-replay-3",
	principal: {
		contentHash: "",
		providerId: null,
		scriptSlug: "script",
		pluginRevision: null,
		subject: { type: "system" },
		metadata: { kind: "workflow" },
		scriptId: SandboxScriptId.make("workflow-script"),
	},
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

const evaluateProjection = (
	fields: Map<string, string>,
	args: ReadonlyArray<string>,
	onRepair: (field: string) => void = () => undefined,
	onExpire: () => void = () => undefined,
) => {
	const expectedHighWater = args[0] ?? "";
	const encodedEntries = args.slice(2);
	expect(expectedHighWater).toBe(String(encodedEntries.length));
	expect(args[1]).toBe(String(24 * 60 * 60));

	const projectionMatches =
		fields.get("high-water") === expectedHighWater &&
		encodedEntries.every((entry, index) => fields.get(String(index)) === entry);
	if (!projectionMatches) {
		fields.set("high-water", expectedHighWater);
		onRepair("high-water");
		encodedEntries.forEach((entry, index) => {
			const field = String(index);
			fields.set(field, entry);
			onRepair(field);
		});
	}
	onExpire();
	return projectionMatches ? "matched" : "repaired";
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
				principal: {
					...workflowInput.principal,
					metadata: { kind: "workflow", capabilities: ["httpCall"] },
				},
			}),
		),
	).toEqual(["replayJournal"]);
	expect(
		Object.keys(
			selectSandboxHostFunctions(bound, {
				principal: {
					...workflowInput.principal,
					metadata: { kind: "script", capabilities: ["replayJournal"] },
				},
			}),
		),
	).toEqual([]);
	expect(
		Object.keys(
			selectSandboxHostFunctions(bound, {
				principal: {
					...workflowInput.principal,
					metadata: { kind: "script", capabilities: ["httpCall", "replayJournal"] },
				},
			}),
		),
	).toEqual(["httpCall"]);
});

it.effect("repairs an unchanged projection deleted at the former read-expire race point", () => {
	const hashes = new Map<string, Map<string, string>>();
	let deleteBeforeEvaluation = false;
	let evalCalls = 0;
	const client = {
		eval: (_script: string, numberOfKeys: number, key: string, ...args: string[]) => {
			expect(numberOfKeys).toBe(1);
			evalCalls += 1;
			if (deleteBeforeEvaluation) {
				hashes.delete(key);
				deleteBeforeEvaluation = false;
			}
			const fields = hashes.get(key) ?? new Map<string, string>();
			const result = evaluateProjection(fields, args);
			hashes.set(key, fields);
			return Promise.resolve(result);
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
		deleteBeforeEvaluation = true;
		yield* projectWorkflowJournalWithRedis({ client }, "projection", journal);
		expect(evalCalls).toBe(2);
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
	let evalCalls = 0;
	let expireCalls = 0;
	let repairCalls = 0;
	const client = {
		eval: (_script: string, _numberOfKeys: number, _key: string, ...args: string[]) => {
			evalCalls += 1;
			const result = evaluateProjection(
				fields,
				args,
				(field) => hsetFields.push(field),
				() => {
					expireCalls += 1;
				},
			);
			if (result === "repaired") {
				repairCalls += 1;
			}
			return Promise.resolve(result);
		},
	};
	const journal = [
		{ request: first, value: { result: 1 } },
		{ request: second, value: { result: 2 } },
	];

	return Effect.gen(function* () {
		yield* projectWorkflowJournalWithRedis({ client }, "incremental", journal);
		expect(hsetFields.filter((field) => /^\d+$/.test(field))).toEqual(["0", "1"]);
		expect(repairCalls).toBe(1);
		expect(fields.get("0")).toBeTruthy();
		expect(fields.get("1")).toBeTruthy();
		expect(fields.get("high-water")).toBe("2");

		yield* projectWorkflowJournalWithRedis({ client }, "incremental", journal);
		expect(evalCalls).toBe(2);
		expect(expireCalls).toBe(2);
		expect(repairCalls).toBe(1);

		fields.delete("1");
		hsetFields.length = 0;
		yield* projectWorkflowJournalWithRedis({ client }, "incremental", journal);
		expect(hsetFields.filter((field) => /^\d+$/.test(field))).toEqual(["0", "1"]);
		expect(repairCalls).toBe(2);

		fields.set("high-water", "invalid");
		fields.delete("0");
		fields.delete("1");
		hsetFields.length = 0;
		yield* projectWorkflowJournalWithRedis({ client }, "incremental", journal);
		expect(hsetFields.filter((field) => /^\d+$/.test(field))).toEqual(["0", "1"]);
		expect(fields.get("high-water")).toBe("2");
	});
});

it.effect("hides stale projection fields above shorter and empty journal high-water marks", () => {
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
		eval: (_script: string, _numberOfKeys: number, _key: string, ...args: string[]) =>
			Promise.resolve(evaluateProjection(fields, args)),
		hget: (_key: string, field: string) => Promise.resolve(fields.get(field) ?? null),
		hmget: (_key: string, ...names: string[]) => {
			hmgetCalls += 1;
			return Promise.resolve(names.map((name) => fields.get(name) ?? null));
		},
	};
	const replayJournal = makeWorkflowReplayJournalHostFunction("reconstructed", { client });
	const rebuiltJournal = [
		{ request: first, value: { result: 1 } },
		{ request: second, value: { result: 2 } },
	];

	return Effect.gen(function* () {
		yield* projectWorkflowJournalWithRedis({ client }, "reconstructed", rebuiltJournal.slice(0, 1));
		const projectedFirstEntry = fields.get("0");
		expect(yield* replayJournal([])).toEqual({
			success: true,
			data: [{ request: first, value: { result: 1 } }],
		});
		expect(fields.get("1")).toBe(secondEntry);
		expect(hmgetCalls).toBe(1);

		yield* projectWorkflowJournalWithRedis({ client }, "reconstructed", []);
		expect(fields.get("high-water")).toBe("0");
		expect(fields.get("0")).toBe(projectedFirstEntry);
		expect(fields.get("1")).toBe(secondEntry);
		expect(yield* replayJournal([])).toEqual({ success: true, data: [] });
		expect(hmgetCalls).toBe(1);

		yield* projectWorkflowJournalWithRedis({ client }, "reconstructed", rebuiltJournal);
		expect(yield* replayJournal([])).toEqual({
			success: true,
			data: [
				{ request: first, value: { result: 1 } },
				{ request: second, value: { result: 2 } },
			],
		});
		expect(hmgetCalls).toBe(2);
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
