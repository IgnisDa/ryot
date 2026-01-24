import { expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { stableStringify } from "@ryot/ts-utils/json";
import { Effect } from "effect";

import { selectSandboxHostFunctions } from "./service";
import type { SandboxRunInput } from "./shared";
import {
	makeWorkflowDurableCallsHostFunction,
	projectWorkflowJournalWithRedis,
} from "./workflow-journal";

const workflowInput: SandboxRunInput = {
	context: {},
	providerId: null,
	compiledCode: "",
	compiledFormat: 1,
	scriptIsBuiltin: false,
	allowedHostFunctions: [],
	scriptId: "workflow-script",
	authority: { type: "system" },
	workflowExecutionId: "parent",
	metadata: { kind: "workflow" },
	executionId: "parent-replay-3",
	cacheNamespace: "workflow-script",
};

const request = (index: number, name: string, input: JsonValue = { index }) => ({
	name,
	index,
	kind: "activity" as const,
	args: { input, scriptSlug: "activity-script" },
});

const journalEntry = (name: string, argsHash: string, value: unknown) =>
	JSON.stringify({ name, value, argsHash, kind: "activity" });

const hash = (value: unknown) =>
	new Bun.CryptoHasher("sha256").update(stableStringify(value)).digest("base64url");

const unusedHostFunction = () => Effect.succeed(null);

const makeRedis = (entries: ReadonlyArray<string | null>) => {
	return {
		service: {
			client: {
				hmget: () => Promise.resolve([...entries]),
				hget: () => Promise.resolve(String(entries.length)),
			},
		},
	};
};

it.effect("returns the full projected journal from one argument-free bootstrap call", () => {
	const first = request(0, "first");
	const second = request(1, "second");
	const redis = makeRedis([
		journalEntry(first.name, hash(first.args), { result: 1 }),
		journalEntry(second.name, hash(second.args), { result: 2 }),
	]);
	const durableCalls = makeWorkflowDurableCallsHostFunction(
		workflowInput.workflowExecutionId,
		redis.service,
	);

	return durableCalls([]).pipe(
		Effect.tap((result) => {
			expect(result).toEqual({ success: true, data: [{ result: 1 }, { result: 2 }] });
		}),
	);
});

it.effect("rejects request-bearing calls instead of retaining the growing-prefix protocol", () => {
	const redis = makeRedis([]);
	const durableCalls = makeWorkflowDurableCallsHostFunction(
		workflowInput.workflowExecutionId,
		redis.service,
	);

	return durableCalls([[request(0, "old-protocol")]]).pipe(
		Effect.tap((result) => {
			expect(result).toEqual({
				success: false,
				error: "durableCalls does not accept arguments",
			});
		}),
	);
});

it("isolates workflow host calls while activities retain normal capabilities", () => {
	const bound = { httpCall: unusedHostFunction, durableCalls: unusedHostFunction };
	expect(
		Object.keys(
			selectSandboxHostFunctions(bound, {
				authority: { type: "system" },
				metadata: { kind: "workflow" },
				allowedHostFunctions: ["httpCall"],
			}),
		),
	).toEqual(["durableCalls"]);
	expect(
		Object.keys(
			selectSandboxHostFunctions(bound, {
				metadata: { kind: "script" },
				authority: { type: "system" },
				allowedHostFunctions: ["durableCalls"],
			}),
		),
	).toEqual([]);
	expect(
		Object.keys(
			selectSandboxHostFunctions(bound, {
				authority: { type: "system" },
				metadata: { kind: "activity" },
				allowedHostFunctions: ["httpCall", "durableCalls"],
			}),
		),
	).toEqual(["httpCall"]);
});

it.effect("rebuilds a deleted Redis projection from the durable journal", () => {
	const hashes = new Map<string, Map<string, string>>();
	const client = {
		expire: () => Promise.resolve(1),
		hget: (key: string, field: string) => Promise.resolve(hashes.get(key)?.get(field) ?? null),
		pipeline: () => {
			const writes: Array<() => void> = [];
			return {
				expire: () => undefined,
				hset: (key: string, field: string, value: string) =>
					writes.push(() => {
						const fields = hashes.get(key) ?? new Map<string, string>();
						fields.set(field, value);
						hashes.set(key, fields);
					}),
				hsetnx: (key: string, field: string, value: string) =>
					writes.push(() => {
						const fields = hashes.get(key) ?? new Map<string, string>();
						if (!fields.has(field)) {
							fields.set(field, value);
						}
						hashes.set(key, fields);
					}),
				exec: () => {
					writes.forEach((write) => write());
					return Promise.resolve([]);
				},
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

it.effect("hides an ahead projection until durable memos rebuild the journal after restart", () => {
	const first = request(0, "first");
	const second = request(1, "second");
	const firstEntry = journalEntry(first.name, hash(first.args), { result: 1 });
	const secondEntry = journalEntry(second.name, hash(second.args), { result: 2 });
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
	const durableCalls = makeWorkflowDurableCallsHostFunction("reconstructed", { client });
	const rebuiltJournal = [
		{ request: first, value: { result: 1 } },
		{ request: second, value: { result: 2 } },
	];

	return Effect.gen(function* () {
		yield* projectWorkflowJournalWithRedis({ client }, "reconstructed", []);
		expect(fields.get("high-water")).toBe("0");
		expect(yield* durableCalls([])).toEqual({ success: true, data: [] });
		expect(hmgetCalls).toBe(0);

		yield* projectWorkflowJournalWithRedis({ client }, "reconstructed", rebuiltJournal.slice(0, 1));
		expect(yield* durableCalls([])).toEqual({ success: true, data: [{ result: 1 }] });
		expect(hmgetCalls).toBe(1);

		yield* projectWorkflowJournalWithRedis({ client }, "reconstructed", rebuiltJournal);
		expect(yield* durableCalls([])).toEqual({
			success: true,
			data: [{ result: 1 }, { result: 2 }],
		});
		expect(hmgetCalls).toBe(2);
		expect(fields.get("0")).toBe(firstEntry);
		expect(fields.get("1")).toBe(secondEntry);
	});
});
