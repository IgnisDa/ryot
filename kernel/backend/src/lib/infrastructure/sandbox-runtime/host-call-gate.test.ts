import { assert, expect, layer } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { hostSuccess } from "@ryot-app/sandbox-sdk/wire";
import {
	workflowHostRequestSchema,
	workflowReplayJournalEntrySchema,
	type WorkflowDurableResult,
} from "@ryot-app/sandbox-sdk/workflow";
import type { Tracer } from "effect";
import {
	Deferred,
	Duration,
	Effect,
	Exit,
	Fiber,
	Layer,
	Queue,
	Scheduler,
	Schema,
	Scope,
} from "effect";
import { TestClock } from "effect/testing";

import type { SandboxFileAccess } from "./file-service";
import { hostCallArgs } from "./host-call-args.test-support";
import {
	SANDBOX_TRANSIENT_MEMORY,
	SandboxHostCallGate,
	type SandboxHostCallGateOptions,
	type SandboxHostResultDelivery,
} from "./host-call-gate";
import { SANDBOX_JSON_GRAPH_FACTOR } from "./json-bytes";
import { MiB, SANDBOX_LIMITS } from "./limits";
import type { BoundHostFunction, SandboxRunInput } from "./shared";
import type { SidecarHostResultFrame } from "./sidecar-protocol";
import { base64DecodedLength, SidecarHostCallFrame } from "./sidecar-protocol";
import { memoryPinnedJournal } from "./workflow-journal.test-support";

type HostCallFrame = typeof SidecarHostCallFrame.Type;
type HostResultFrame = typeof SidecarHostResultFrame.Type;
const encodeUnknownJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeUnknownJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJournalEntryJson = Schema.decodeSync(
	Schema.fromJsonString(workflowReplayJournalEntrySchema),
);

const userId = UserId.make("gate-user");
const metadataCapabilities = ["getCachedValue", "httpCall", "artifact-read", "scratch"] as const;

const makeInput = (
	capabilities: NonNullable<SandboxRunInput["principal"]["metadata"]["capabilities"]> = [
		...metadataCapabilities,
	],
	options: Pick<
		SandboxRunInput,
		"workflowExecutionId" | "replayJournal" | "inlineDurableHost"
	> = {},
): SandboxRunInput => ({
	context: {},
	compiledCode: "",
	compiledFormat: 1,
	executionId: "gate-execution",
	principal: {
		contentHash: "",
		providerId: null,
		pluginRevision: null,
		scriptSlug: "gate-script",
		scriptId: SandboxScriptId.make("gate-script"),
		metadata: { capabilities, kind: "workflow", runtimeImports: [] },
		subject: {
			userId,
			type: "user",
			accountGeneration: { userId, token: "gate-account-generation" },
		},
	},
	...options,
});

const makeFiles = (
	artifactReadRange: SandboxFileAccess["artifactReadRange"] = (args) =>
		Effect.succeed({ size: 0, data: "", offset: args.offset }),
	scratchWrite: SandboxFileAccess["scratchWrite"] = () => Effect.succeed(null),
): SandboxFileAccess => ({
	scratchWrite,
	artifactReadRange,
	harvest: () => Effect.succeed(null),
	filesystem: { scratch: false, artifact: false, namedArtifacts: [] },
});

const makeFrame = (
	seq: number,
	name: string,
	args: unknown,
	options: { readonly handle?: string; readonly generation?: number } = {},
): HostCallFrame =>
	Schema.decodeSync(SidecarHostCallFrame)({
		seq,
		name,
		type: "hostCall",
		args: hostCallArgs(args),
		generation: options.generation ?? 1,
		handle: options.handle ?? "gate-handle",
	});

const frameValue = (frame: HostResultFrame) =>
	frame.result.status === "success" ? frame.result.value : null;

const successHostFunction = (
	record: (args: ReadonlyArray<unknown>) => unknown = (args) => args[0] ?? null,
) =>
	((args: ReadonlyArray<unknown>) =>
		Effect.sync(() => hostSuccess(record(args)))) satisfies BoundHostFunction;

const makeOptions = (
	parentSpan: Tracer.AnySpan,
	input: SandboxRunInput = makeInput(),
	apiFunctions: Readonly<Record<string, BoundHostFunction>> = {
		getCachedValue: successHostFunction(),
	},
	files: SandboxFileAccess = makeFiles(),
	handle = "gate-handle",
	instance = "gate-instance",
	generation = 1,
): SandboxHostCallGateOptions => ({
	input,
	files,
	handle,
	instance,
	generation,
	parentSpan,
	apiFunctions,
});

const cachedValueRequest = (index: number) =>
	Schema.decodeSync(workflowHostRequestSchema)({
		index,
		kind: "host",
		name: "getCachedValue",
		args: { args: [], capability: "getCachedValue" },
	});

const gateLayer = Layer.mergeAll(SandboxHostCallGate.layer, TestClock.layer());

const permitBytes = (frame: HostCallFrame, resultBytes: number) =>
	SANDBOX_JSON_GRAPH_FACTOR * base64DecodedLength(frame.args) + resultBytes;

const holdReplies = () => {
	const written: Array<() => void> = [];
	const deliver: SandboxHostResultDelivery = (_reply, released) =>
		Effect.sync(() => {
			written.push(released);
		});
	return { written, deliver };
};

const inlineInput = (
	capabilities: ReadonlyArray<"httpCall" | "listIntegrations">,
	settle: (count: number) => ReadonlyArray<WorkflowDurableResult>,
	settled: { count: number },
) =>
	makeInput([...capabilities], {
		replayJournal: memoryPinnedJournal([]),
		workflowExecutionId: "memory-workflow",
		inlineDurableHost: {
			capabilities: [...capabilities],
			settle: (requests) =>
				Effect.sync(() => {
					settled.count += 1;
					return settle(requests.length);
				}),
		},
	});

const permitFrame = (seq: number) =>
	makeFrame(seq, "httpCall", ["GET", "https://example.com/permit"], { handle: "permits" });

const httpRequests = (count: number, firstIndex = 0) =>
	Array.from({ length: count }, (_, offset) => ({
		kind: "host",
		name: "httpCall",
		index: firstIndex + offset,
		args: { capability: "httpCall", args: ["GET", "https://example.com/memory"] },
	}));

const reserveBatch = (seq: number) =>
	makeFrame(seq, "inlineBatch", { requests: httpRequests(1) }, { handle: "reserve" });

layer(gateLayer)((test) => {
	test.effect("counts ordinary host waits while pausing only validated inline settlement", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const parentSpan = yield* Effect.currentSpan;
				const ordinaryStarted = yield* Deferred.make<void>();
				const releaseOrdinary = yield* Deferred.make<void>();
				const settlementStarted = yield* Deferred.make<void>();
				const releaseSettlement = yield* Deferred.make<void>();
				const result: WorkflowDurableResult = { value: null, state: "success" };
				const input = makeInput(["getCachedValue"], {
					replayJournal: memoryPinnedJournal([]),
					workflowExecutionId: "budget-workflow",
					inlineDurableHost: {
						capabilities: ["getCachedValue"],
						settle: (requests) =>
							Deferred.succeed(settlementStarted, undefined).pipe(
								Effect.andThen(Deferred.await(releaseSettlement)),
								Effect.as(requests.map(() => result)),
							),
					},
				});
				const registration = yield* gate.register(
					makeOptions(parentSpan, input, {
						getCachedValue: () =>
							Deferred.succeed(ordinaryStarted, undefined).pipe(
								Effect.andThen(Deferred.await(releaseOrdinary)),
								Effect.as(hostSuccess(null)),
							),
					}),
				);
				const ordinary = yield* registration
					.dispatch(makeFrame(0, "getCachedValue", []))
					.pipe(Effect.forkScoped);
				yield* Deferred.await(ordinaryStarted);
				yield* TestClock.adjust("4 seconds");
				expect(yield* registration.scriptBudget).toEqual({ settledMs: 0, remainingMs: 26_000 });
				yield* Deferred.succeed(releaseOrdinary, undefined);
				yield* Fiber.join(ordinary);
				const request = yield* Schema.decodeEffect(workflowHostRequestSchema)({
					index: 0,
					kind: "host",
					name: "getCachedValue",
					args: { args: ["key"], capability: "getCachedValue" },
				});
				const inline = yield* registration
					.dispatch(makeFrame(1, "inlineBatch", { requests: [request] }))
					.pipe(Effect.forkScoped);
				yield* Deferred.await(settlementStarted);
				yield* TestClock.adjust("5 seconds");
				expect(yield* registration.scriptBudget).toEqual({ settledMs: 0, remainingMs: 26_000 });
				yield* Deferred.succeed(releaseSettlement, undefined);
				yield* Fiber.join(inline);
				expect(yield* registration.scriptBudget).toEqual({ settledMs: 5_000, remainingMs: 26_000 });
				yield* registration.extend(5_000);
				yield* TestClock.adjust("26 seconds");
				expect(yield* registration.scriptBudget).toEqual({ remainingMs: 0, settledMs: 5_000 });
			}),
		).pipe(Effect.withSpan("sandbox.gate.budget-test")),
	);
	test.effect("host_call_gate_preserves_session_protections", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
			const parentSpan = yield* Effect.currentSpan;
			let calls = 0;
			let httpCalls = 0;
			let fileReads = 0;
			let controlDispatches = 0;
			const apiFunctions: Readonly<Record<string, BoundHostFunction>> = {
				httpCall: () =>
					Effect.sync(() => {
						httpCalls += 1;
						return hostSuccess(null);
					}),
				setCachedValue: () =>
					Effect.sync(() => {
						controlDispatches += 1;
						return hostSuccess(null);
					}),
				artifactReadRange: () =>
					Effect.sync(() => {
						controlDispatches += 1;
						return hostSuccess(null);
					}),
				getCachedValue: successHostFunction((args) => {
					calls += 1;
					return args[0] === "large-response"
						? "x".repeat(SANDBOX_LIMITS.bridge.responseBytes + 1)
						: (args[0] ?? null);
				}),
			};
			const registration = yield* gate.register(
				makeOptions(
					parentSpan,
					makeInput(),
					apiFunctions,
					makeFiles((args) =>
						Effect.sync(() => {
							fileReads += 1;
							return { size: 0, data: "", offset: args.offset };
						}),
					),
				),
			);

			const foreign = yield* registration.dispatch(
				makeFrame(0, "getCachedValue", ["foreign"], { handle: "foreign-handle" }),
			);
			const wrongGeneration = yield* registration.dispatch(
				makeFrame(0, "getCachedValue", ["foreign"], { generation: 2 }),
			);
			expect(frameValue(foreign)).toMatchObject({ success: false });
			expect(frameValue(wrongGeneration)).toMatchObject({ success: false });
			expect(calls).toBe(0);

			const first = yield* registration.dispatch(makeFrame(0, "getCachedValue", ["accepted"]));
			const duplicate = yield* registration.dispatch(makeFrame(0, "getCachedValue", ["duplicate"]));
			const next = yield* registration.dispatch(makeFrame(2, "getCachedValue", ["next"]));
			const reordered = yield* registration.dispatch(makeFrame(1, "getCachedValue", ["reordered"]));
			const reorderedDuplicate = yield* registration.dispatch(
				makeFrame(1, "getCachedValue", ["reordered-duplicate"]),
			);
			expect(frameValue(first)).toMatchObject({ success: true, data: "accepted" });
			expect(frameValue(next)).toMatchObject({ data: "next", success: true });
			expect(frameValue(reordered)).toMatchObject({ success: true, data: "reordered" });
			expect(frameValue(duplicate)).toMatchObject({ success: false });
			expect(frameValue(reorderedDuplicate)).toMatchObject({ success: false });
			expect(calls).toBe(3);

			const notPinned = yield* registration.dispatch(
				makeFrame(3, "setCachedValue", ["key", "value", 60]),
			);
			const fileControl = yield* registration.dispatch(
				makeFrame(4, "artifactReadRange", { length: 1, offset: 0 }),
			);
			const oversizedRequest = yield* registration.dispatch(
				makeFrame(5, "getCachedValue", ["x".repeat(SANDBOX_LIMITS.bridge.requestBytes)]),
			);
			const oversizedResponse = yield* registration.dispatch(
				makeFrame(6, "getCachedValue", ["large-response"]),
			);
			expect(frameValue(notPinned)).toMatchObject({ success: false });
			expect(frameValue(fileControl)).toMatchObject({ size: 0, data: "", offset: 0 });
			expect(frameValue(oversizedRequest)).toMatchObject({ success: false });
			expect(frameValue(oversizedResponse)).toMatchObject({ success: false });
			expect(fileReads).toBe(1);
			expect(controlDispatches).toBe(0);
			expect(calls).toBe(4);

			const httpResponses = yield* Effect.forEach(
				Array.from({ length: SANDBOX_LIMITS.hostCalls.http + 1 }, (_, index) => index),
				(index) =>
					registration.dispatch(makeFrame(7 + index, "httpCall", ["GET", "https://example.test"])),
			);
			expect(httpCalls).toBe(SANDBOX_LIMITS.hostCalls.http);
			expect(frameValue(httpResponses[httpResponses.length - 1] ?? first)).toMatchObject({
				success: false,
				data: { operation: "httpCall", code: "execution-limit" },
			});

			let totalCalls = 0;
			let budgetFileReads = 0;
			let budgetFileWrites = 0;
			const budgetRegistration = yield* gate.register(
				makeOptions(
					parentSpan,
					makeInput(["getCachedValue"]),
					{
						getCachedValue: () =>
							Effect.sync(() => {
								totalCalls += 1;
								return hostSuccess(null);
							}),
					},
					makeFiles(
						(args) =>
							Effect.sync(() => {
								budgetFileReads += 1;
								return { size: 0, data: "", offset: args.offset };
							}),
						() =>
							Effect.sync(() => {
								budgetFileWrites += 1;
								return null;
							}),
					),
					"budget-handle",
				),
			);
			yield* Effect.forEach(
				Array.from({ length: SANDBOX_LIMITS.hostCalls.total - 1 }, (_, index) => index),
				(index) =>
					budgetRegistration.dispatch(
						makeFrame(index, "getCachedValue", [], { handle: "budget-handle" }),
					),
			);
			const chargedFileRead = yield* budgetRegistration.dispatch(
				makeFrame(
					SANDBOX_LIMITS.hostCalls.total - 1,
					"artifactReadRange",
					{ length: 1, offset: 0 },
					{ handle: "budget-handle" },
				),
			);
			const overBudgetFileWrite = yield* budgetRegistration.dispatch(
				makeFrame(
					SANDBOX_LIMITS.hostCalls.total,
					"scratchWrite",
					{ data: "", offset: 0, final: true, name: "file" },
					{ handle: "budget-handle" },
				),
			);
			expect(totalCalls).toBe(SANDBOX_LIMITS.hostCalls.total - 1);
			expect(budgetFileReads).toBe(1);
			expect(budgetFileWrites).toBe(0);
			expect(frameValue(chargedFileRead)).toMatchObject({ size: 0, data: "", offset: 0 });
			expect(frameValue(overBudgetFileWrite)).toMatchObject({
				success: false,
				data: { code: "execution-limit" },
			});

			const journalRequest = yield* Schema.decodeEffect(workflowHostRequestSchema)({
				index: 0,
				kind: "host",
				name: "getCachedValue",
				args: { args: [], capability: "getCachedValue" },
			});
			const journalRegistration = yield* gate.register(
				makeOptions(
					parentSpan,
					makeInput(["getCachedValue"], {
						workflowExecutionId: "journal-workflow",
						replayJournal: memoryPinnedJournal([{ value: null, request: journalRequest }]),
					}),
					{ getCachedValue: successHostFunction() },
					makeFiles(),
					"journal-budget-handle",
				),
			);
			const journalReads = yield* Effect.forEach(
				Array.from({ length: 2_048 }, (_, index) => index),
				(index) =>
					journalRegistration.dispatch(
						makeFrame(
							index,
							"journalRead",
							{ length: 1, offset: 0 },
							{ handle: "journal-budget-handle" },
						),
					),
			);
			const journalReadLimit = yield* journalRegistration.dispatch(
				makeFrame(
					2_048,
					"journalRead",
					{ length: 1, offset: 0 },
					{ handle: "journal-budget-handle" },
				),
			);
			const afterJournalLimit = yield* journalRegistration.dispatch(
				makeFrame(2_049, "getCachedValue", [], { handle: "journal-budget-handle" }),
			);
			expect(journalReads).toHaveLength(2_048);
			expect(frameValue(journalReads[0] ?? first)).toMatchObject({
				offset: 0,
				totalBytes: expect.any(Number),
			});
			expect(frameValue(journalReadLimit)).toMatchObject({ success: false });
			expect(frameValue(afterJournalLimit)).toMatchObject({ data: null, success: true });

			let active = 0;
			let maximumActive = 0;
			let concurrentCalls = 0;
			const started = yield* Queue.unbounded<void>();
			const release = yield* Queue.unbounded<void>();
			const concurrentRegistration = yield* gate.register(
				makeOptions(
					parentSpan,
					makeInput(["getCachedValue"]),
					{
						getCachedValue: () =>
							Effect.gen(function* () {
								active += 1;
								concurrentCalls += 1;
								maximumActive = Math.max(maximumActive, active);
								yield* Queue.offer(started, undefined);
								return yield* Queue.take(release).pipe(
									Effect.as(hostSuccess(null)),
									Effect.ensuring(Effect.sync(() => (active -= 1))),
								);
							}),
					},
					makeFiles(),
					"concurrency-handle",
				),
			);
			const concurrentFibers = yield* Effect.forEach(
				Array.from({ length: 9 }, (_, index) => index),
				(index) =>
					Effect.forkChild(
						concurrentRegistration.dispatch(
							makeFrame(index, "getCachedValue", [], { handle: "concurrency-handle" }),
						),
					),
			);
			yield* Effect.replicateEffect(Queue.take(started), SANDBOX_LIMITS.bridge.concurrentHostCalls);
			expect(maximumActive).toBe(SANDBOX_LIMITS.bridge.concurrentHostCalls);
			const ninth = concurrentFibers[8];
			if (!ninth) {
				throw new Error("missing ninth host call fiber");
			}
			expect(frameValue(yield* Fiber.join(ninth))).toMatchObject({ success: false });
			yield* Queue.offerAll(
				release,
				Array.from({ length: SANDBOX_LIMITS.bridge.concurrentHostCalls }, () => undefined),
			);
			yield* Effect.replicateEffect(Queue.take(started), SANDBOX_LIMITS.bridge.concurrentHostCalls);
			expect(maximumActive).toBe(SANDBOX_LIMITS.bridge.concurrentHostCalls);
			yield* Queue.offerAll(
				release,
				Array.from({ length: SANDBOX_LIMITS.bridge.concurrentHostCalls }, () => undefined),
			);
			const concurrentResults = yield* Effect.forEach(concurrentFibers, Fiber.join);
			expect(concurrentCalls).toBe(SANDBOX_LIMITS.bridge.concurrentHostCalls * 2);
			const successfulConcurrentResults = concurrentResults.filter((result) => {
				const value = frameValue(result);
				return (
					typeof value === "object" && value !== null && Reflect.get(value, "success") === true
				);
			});
			expect(successfulConcurrentResults).toHaveLength(
				SANDBOX_LIMITS.bridge.concurrentHostCalls * 2,
			);

			const interruptedStarted = yield* Deferred.make<void>();
			let interrupted = 0;
			const interruptRegistration = yield* gate.register(
				makeOptions(
					parentSpan,
					makeInput(["getCachedValue"]),
					{
						getCachedValue: () =>
							Deferred.succeed(interruptedStarted, undefined).pipe(
								Effect.andThen(Effect.never),
								Effect.ensuring(Effect.sync(() => (interrupted += 1))),
							),
					},
					makeFiles(),
					"interrupt-handle",
				),
			);
			const interruptedFiber = yield* Effect.forkChild(
				interruptRegistration.dispatch(
					makeFrame(0, "getCachedValue", [], { handle: "interrupt-handle" }),
				),
			);
			yield* Deferred.await(interruptedStarted);
			yield* Fiber.interrupt(interruptedFiber);
			expect(interrupted).toBe(1);

			const expiryRegistration = yield* gate.register(
				makeOptions(
					parentSpan,
					makeInput(["getCachedValue"]),
					{
						getCachedValue: successHostFunction(() => {
							calls += 1;
							return null;
						}),
					},
					makeFiles(),
					"expiry-handle",
				),
			);
			yield* TestClock.adjust(Duration.millis(32_001));
			const expired = yield* expiryRegistration.dispatch(
				makeFrame(0, "getCachedValue", [], { handle: "expiry-handle" }),
			);
			expect(frameValue(expired)).toMatchObject({ success: false });
			expect(calls).toBe(4);

			yield* registration.close;
			const afterClose = yield* registration.dispatch(
				makeFrame(7 + SANDBOX_LIMITS.hostCalls.http + 1, "getCachedValue", ["late"]),
			);
			expect(frameValue(afterClose)).toMatchObject({ success: false });

			const oldScope = yield* Scope.make();
			const newScope = yield* Scope.make();
			const replacementStarted = yield* Deferred.make<void>();
			let replacementInterrupted = 0;
			const replacementOld = yield* gate
				.register(
					makeOptions(
						parentSpan,
						makeInput(["getCachedValue"]),
						{
							getCachedValue: () =>
								Deferred.succeed(replacementStarted, undefined).pipe(
									Effect.andThen(Effect.never),
									Effect.ensuring(Effect.sync(() => (replacementInterrupted += 1))),
								),
						},
						makeFiles(),
						"replacement-handle",
					),
				)
				.pipe(Effect.provideService(Scope.Scope, oldScope));
			const retiredCall = yield* Effect.forkChild(
				replacementOld.dispatch(
					makeFrame(0, "getCachedValue", [], { handle: "replacement-handle" }),
				),
			);
			yield* Deferred.await(replacementStarted);
			const replacementNew = yield* gate
				.register(
					makeOptions(
						parentSpan,
						makeInput(["getCachedValue"]),
						{ getCachedValue: successHostFunction() },
						makeFiles(),
						"replacement-handle",
					),
				)
				.pipe(Effect.provideService(Scope.Scope, newScope));
			expect(frameValue(yield* Fiber.join(retiredCall))).toMatchObject({ success: false });
			expect(replacementInterrupted).toBe(1);
			yield* Scope.close(oldScope, Exit.void);
			const successor = yield* replacementNew.dispatch(
				makeFrame(0, "getCachedValue", ["successor"], { handle: "replacement-handle" }),
			);
			expect(frameValue(successor)).toMatchObject({ success: true, data: "successor" });
			yield* replacementOld.close;
			yield* Scope.close(newScope, Exit.void);
		}).pipe(Effect.withSpan("host-call-gate.session-protections")),
	);

	test.effect("inline_records_are_host_owned_and_survive_committed_replay", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
			const parentSpan = yield* Effect.currentSpan;
			const request = yield* Schema.decodeEffect(workflowHostRequestSchema)({
				index: 0,
				kind: "host",
				name: "getCachedValue",
				args: { args: ["trusted-result"], capability: "getCachedValue" },
			});
			const durableResult: WorkflowDurableResult = {
				state: "success",
				value: { answer: 42, source: "trusted-host" },
			};
			let settlementCalls = 0;
			const settlementStarted = yield* Deferred.make<void>();
			const input = makeInput(["getCachedValue"], {
				workflowExecutionId: "gate-workflow",
				replayJournal: memoryPinnedJournal([]),
				inlineDurableHost: {
					capabilities: ["getCachedValue"],
					settle: (requests) =>
						Deferred.succeed(settlementStarted, undefined).pipe(
							Effect.andThen(Effect.sleep("250 millis")),
							Effect.map(() => {
								settlementCalls += 1;
								return requests.map(() => durableResult);
							}),
						),
				},
			});
			const registration = yield* gate.register(
				makeOptions(parentSpan, input, {}, makeFiles(), "inline-handle"),
			);
			yield* TestClock.adjust("31.9 seconds");

			const malformed = yield* registration.dispatch(
				makeFrame(
					0,
					"inlineBatch",
					{
						requests: [{ ...request, index: 9 }],
						results: [{ state: "success", value: { forged: true } }],
					},
					{ handle: "inline-handle" },
				),
			);
			expect(frameValue(malformed)).toMatchObject({ success: false });
			expect(registration.inlineEntries()).toEqual([]);

			const deferred = yield* registration.dispatch(
				makeFrame(
					1,
					"inlineBatch",
					{ requests: [{ ...request, index: 9 }] },
					{ handle: "inline-handle" },
				),
			);
			expect(frameValue(deferred)).toEqual({ defer: true });
			expect(settlementCalls).toBe(0);

			const settling = yield* Effect.forkChild(
				registration.dispatch(
					makeFrame(2, "inlineBatch", { requests: [request] }, { handle: "inline-handle" }),
				),
			);
			yield* Deferred.await(settlementStarted);
			yield* TestClock.adjust("250 millis");
			const reply = yield* Fiber.join(settling);
			expect(frameValue(reply)).toEqual({ results: [durableResult] });
			expect(settlementCalls).toBe(1);
			const rejectedExtension = yield* Effect.exit(registration.extend(251));
			expect(rejectedExtension).toMatchObject({ _tag: "Failure" });
			yield* registration.extend(250);
			const inlineEntries = registration.inlineEntries();
			expect(inlineEntries).toEqual([{ request, value: durableResult }]);

			const externalCopy = decodeUnknownJson(encodeUnknownJson(inlineEntries[0]));
			if (typeof externalCopy !== "object" || externalCopy === null) {
				throw new Error("expected a copied inline journal entry");
			}
			Reflect.set(externalCopy, "value", { forged: true });
			expect(registration.inlineEntries()).toEqual([{ request, value: durableResult }]);

			yield* TestClock.adjust("101 millis");
			const expiredAfterExtension = yield* registration.dispatch(
				makeFrame(3, "getCachedValue", [], { handle: "inline-handle" }),
			);
			expect(frameValue(expiredAfterExtension)).toMatchObject({ success: false });

			const committedInput = makeInput(["getCachedValue"], {
				workflowExecutionId: "gate-workflow",
				replayJournal: memoryPinnedJournal(inlineEntries),
			});
			const replay = yield* gate.register(
				makeOptions(parentSpan, committedInput, {}, makeFiles(), "replay-handle"),
			);
			const replayJournal = replay.journal;
			if (!replayJournal) {
				throw new Error("expected the committed journal prefix");
			}
			expect(replayJournal).toEqual({
				length: 1,
				totalBytes: replayJournal.totalBytes,
				offsets: [0, replayJournal.totalBytes],
			});
			const read = yield* replay.dispatch(
				makeFrame(0, "journalRead", { offset: 0, length: MiB }, { handle: "replay-handle" }),
			);
			const readValue = frameValue(read);
			if (typeof readValue !== "object" || readValue === null || Array.isArray(readValue)) {
				throw new Error("expected a journal range result");
			}
			const encoded = Reflect.get(readValue, "data");
			if (typeof encoded !== "string") {
				throw new Error("expected base64 journal data");
			}
			const binary = atob(encoded);
			const journalEntry = decodeJournalEntryJson(
				new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))),
			);
			expect(journalEntry).toEqual({ request, value: durableResult });
		}).pipe(Effect.withSpan("host-call-gate.inline-records")),
	);

	test.effect("inline_batch_over_budget_is_deferred_and_still_charged", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
			const parentSpan = yield* Effect.currentSpan;
			let settlements = 0;
			const input = makeInput(["httpCall"], {
				replayJournal: memoryPinnedJournal([]),
				workflowExecutionId: "gate-budget-workflow",
				inlineDurableHost: {
					capabilities: ["httpCall"],
					settle: (requests) =>
						Effect.sync(() => {
							settlements += 1;
							return requests.map(() => ({ value: null, state: "success" as const }));
						}),
				},
			});
			const registration = yield* gate.register(
				makeOptions(parentSpan, input, { httpCall: successHostFunction() }, makeFiles(), "budget"),
			);
			const requests = Array.from({ length: SANDBOX_LIMITS.hostCalls.http + 1 }, (_, index) => ({
				index,
				kind: "host",
				name: "httpCall",
				args: { capability: "httpCall", args: ["GET", "https://example.com/budget"] },
			}));
			const deferred = yield* registration.dispatch(
				makeFrame(0, "inlineBatch", { requests }, { handle: "budget" }),
			);
			expect(frameValue(deferred)).toEqual({ defer: true });
			expect(settlements).toBe(0);
			expect(registration.inlineEntries()).toEqual([]);

			const charged = yield* registration.dispatch(
				makeFrame(1, "httpCall", ["GET", "https://example.com/after"], { handle: "budget" }),
			);
			expect(frameValue(charged)).toMatchObject({
				success: false,
				data: { operation: "httpCall", code: "execution-limit" },
				error: `Sandbox execution exceeds ${SANDBOX_LIMITS.hostCalls.http} httpCall calls`,
			});
		}).pipe(Effect.withSpan("host-call-gate.inline-budget")),
	);
});

layer(gateLayer)((test) => {
	test.effect("host_call_permits_cover_maximum_results_until_written", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const parentSpan = yield* Effect.currentSpan;
				const registration = yield* gate.register(
					makeOptions(
						parentSpan,
						makeInput(["httpCall"]),
						{ httpCall: successHostFunction() },
						makeFiles(),
						"permits",
					),
				);
				const replies = holdReplies();
				const ordinary = permitBytes(permitFrame(0), SANDBOX_TRANSIENT_MEMORY.ordinaryBytes);
				for (const seq of [0, 1, 2, 3]) {
					yield* registration.dispatch(permitFrame(seq), replies.deliver);
				}
				expect(gate.transientMemory()).toEqual({ waiting: 0, used: 4 * ordinary });

				const blocked = yield* registration
					.dispatch(permitFrame(4), replies.deliver)
					.pipe(Effect.forkScoped);
				yield* Effect.yieldNow;
				expect(gate.transientMemory()).toEqual({ waiting: 1, used: 4 * ordinary });
				replies.written.shift()?.();
				yield* Fiber.join(blocked);
				expect(gate.transientMemory()).toEqual({ waiting: 0, used: 4 * ordinary });
				for (const released of replies.written.splice(0)) {
					released();
				}
				expect(gate.transientMemory()).toEqual({ used: 0, waiting: 0 });
			}),
		).pipe(Effect.withSpan("host-call-gate.permits")),
	);

	test.effect("host_call_args_decode_under_transient_permit", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const parentSpan = yield* Effect.currentSpan;
				const registration = yield* gate.register(
					makeOptions(
						parentSpan,
						makeInput(["httpCall"]),
						{ httpCall: successHostFunction() },
						makeFiles(),
						"permits",
					),
				);
				const replies = holdReplies();
				for (const seq of [0, 1, 2, 3]) {
					yield* registration.dispatch(permitFrame(seq), replies.deliver);
				}
				const undecodable = yield* Schema.decodeEffect(SidecarHostCallFrame)({
					seq: 4,
					generation: 1,
					type: "hostCall",
					name: "httpCall",
					handle: "permits",
					args: btoa("[".repeat(1024)),
				});
				const waiting = yield* registration.dispatch(undecodable).pipe(Effect.forkScoped);
				yield* Effect.yieldNow;
				expect(gate.transientMemory().waiting).toBe(1);
				for (const released of replies.written.splice(0)) {
					released();
				}
				expect(frameValue(yield* Fiber.join(waiting))).toMatchObject({
					success: false,
					error: "Sandbox host call arguments are invalid",
				});
				expect(gate.transientMemory()).toEqual({ used: 0, waiting: 0 });
			}),
		).pipe(Effect.withSpan("host-call-gate.args-permit")),
	);

	test.effect("interrupted_dispatch_never_leaks_permits_at_any_point", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
			const parentSpan = yield* Effect.currentSpan;
			for (const yieldBudget of [3, 8]) {
				for (let yields = 0; yields < 40; yields += 1) {
					const scope = yield* Scope.make();
					const registration = yield* gate
						.register(
							makeOptions(
								parentSpan,
								makeInput(["getCachedValue"]),
								undefined,
								makeFiles(),
								"interrupted",
							),
						)
						.pipe(Scope.provide(scope));
					const replies = holdReplies();
					const call = yield* registration
						.dispatch(
							makeFrame(0, "getCachedValue", ["key"], { handle: "interrupted" }),
							replies.deliver,
						)
						.pipe(
							Effect.provideService(Scheduler.MaxOpsBeforeYield, yieldBudget),
							Effect.forkDetach,
						);
					for (let step = 0; step < yields; step += 1) {
						yield* Effect.yieldNow;
					}
					yield* Fiber.interrupt(call);
					for (const released of replies.written.splice(0)) {
						released();
					}
					yield* Scope.close(scope, Exit.void);
					expect(gate.transientMemory()).toEqual({ used: 0, waiting: 0 });
				}
			}
		}).pipe(Effect.withSpan("host-call-gate.interrupted")),
	);

	test.effect("cancelled_host_calls_release_permits_after_native_completion", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
			const parentSpan = yield* Effect.currentSpan;
			const started = yield* Deferred.make<void>();
			const finish = yield* Deferred.make<void>();
			const scope = yield* Scope.make();
			const registration = yield* gate
				.register(
					makeOptions(
						parentSpan,
						makeInput(["getCachedValue"]),
						{
							getCachedValue: () =>
								Deferred.succeed(started, undefined).pipe(
									Effect.andThen(Deferred.await(finish)),
									Effect.as(hostSuccess(null)),
									Effect.uninterruptible,
								),
						},
						makeFiles(),
						"cancelled",
					),
				)
				.pipe(Scope.provide(scope));
			const frame = makeFrame(0, "getCachedValue", ["key"], { handle: "cancelled" });
			const call = yield* registration.dispatch(frame).pipe(Effect.forkChild);
			yield* Deferred.await(started);
			const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild);
			yield* Effect.yieldNow;
			expect(gate.transientMemory()).toEqual({
				waiting: 0,
				used: permitBytes(frame, SANDBOX_TRANSIENT_MEMORY.smallBytes),
			});
			expect(closing.pollUnsafe()).toBeUndefined();
			yield* Deferred.succeed(finish, undefined);
			yield* Fiber.join(closing);
			expect(frameValue(yield* Fiber.join(call))).toMatchObject({ success: false });
			expect(gate.transientMemory()).toEqual({ used: 0, waiting: 0 });
		}).pipe(Effect.withSpan("host-call-gate.cancelled")),
	);

	test.effect("inline_batches_reserve_before_settlement_and_defer_without_side_effects", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const parentSpan = yield* Effect.currentSpan;
				const settled = { count: 0 };
				const registration = yield* gate.register(
					makeOptions(
						parentSpan,
						inlineInput(
							["httpCall"],
							(count) => Array.from({ length: count }, () => ({ value: null, state: "success" })),
							settled,
						),
						{ httpCall: successHostFunction() },
						makeFiles(),
						"reserve",
					),
				);
				const replies = holdReplies();
				for (const seq of [0, 1]) {
					yield* registration.dispatch(
						makeFrame(seq, "httpCall", ["GET", "https://example.com/held"], { handle: "reserve" }),
						replies.deliver,
					);
				}
				expect(frameValue(yield* registration.dispatch(reserveBatch(2)))).toEqual({ defer: true });
				expect(settled.count).toBe(0);

				for (const released of replies.written.splice(0)) {
					released();
				}
				expect(frameValue(yield* registration.dispatch(reserveBatch(3)))).toEqual({
					results: [{ value: null, state: "success" }],
				});
				expect(settled.count).toBe(1);
			}),
		).pipe(Effect.withSpan("host-call-gate.inline-reserve")),
	);

	test.effect("inline_batches_bound_held_results_before_settlement", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const parentSpan = yield* Effect.currentSpan;
				const settled = { count: 0 };
				const registration = yield* gate.register(
					makeOptions(
						parentSpan,
						inlineInput(
							["httpCall", "listIntegrations"],
							(count) => Array.from({ length: count }, () => ({ value: null, state: "success" })),
							settled,
						),
						{},
						makeFiles(),
						"bounded",
					),
				);
				const batch = (seq: number, requests: ReadonlyArray<unknown>) =>
					registration.dispatch(makeFrame(seq, "inlineBatch", { requests }, { handle: "bounded" }));
				const allowance =
					SANDBOX_TRANSIENT_MEMORY.inlineValueBytes / (2 * SANDBOX_LIMITS.http.responseBytes);

				expect(frameValue(yield* batch(0, httpRequests(allowance + 1)))).toEqual({ defer: true });
				expect(
					frameValue(
						yield* batch(1, [
							{
								index: 0,
								kind: "host",
								name: "listIntegrations",
								args: { args: [], capability: "listIntegrations" },
							},
						]),
					),
				).toEqual({ defer: true });
				expect(settled.count).toBe(0);
				expect(frameValue(yield* batch(2, httpRequests(allowance)))).toMatchObject({
					results: Array.from({ length: allowance }, () => ({ value: null, state: "success" })),
				});
				expect(settled.count).toBe(1);
			}),
		).pipe(Effect.withSpan("host-call-gate.inline-bound")),
	);

	test.effect("inline_evidence_exhaustion_defers_before_settlement", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
			const parentSpan = yield* Effect.currentSpan;
			const settled = { count: 0 };
			const value = "x".repeat(9 * MiB);
			const scope = yield* Scope.make();
			const registration = yield* gate
				.register(
					makeOptions(
						parentSpan,
						inlineInput(
							["httpCall"],
							(count) => Array.from({ length: count }, () => ({ value, state: "success" })),
							settled,
						),
						{},
						makeFiles(),
						"evidence",
					),
				)
				.pipe(Scope.provide(scope));
			const batch = (index: number) =>
				registration.dispatch(
					makeFrame(
						index,
						"inlineBatch",
						{ requests: httpRequests(1, index) },
						{ handle: "evidence" },
					),
				);
			for (const index of [0, 1, 2, 3]) {
				expect(frameValue(yield* batch(index))).toMatchObject({ results: [{ value }] });
			}
			const evidence = registration
				.inlineEntries()
				.reduce(
					(sum, entry) => sum + new TextEncoder().encode(encodeUnknownJson(entry)).byteLength,
					0,
				);
			expect(gate.transientMemory()).toEqual({
				waiting: 0,
				used: SANDBOX_TRANSIENT_MEMORY.evidenceCopies * evidence,
			});

			expect(frameValue(yield* batch(4))).toEqual({ defer: true });
			expect(settled.count).toBe(4);
			yield* Scope.close(scope, Exit.void);
			expect(gate.transientMemory()).toEqual({ used: 0, waiting: 0 });
		}).pipe(Effect.withSpan("host-call-gate.inline-evidence")),
	);
	test.effect("lazy_journal_reads_charge_fetched_chunks_and_fail_closed", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
			const parentSpan = yield* Effect.currentSpan;
			const journal = memoryPinnedJournal([
				{ value: "small", request: cachedValueRequest(0) },
				{ value: "日本語".repeat(300_000), request: cachedValueRequest(1) },
			]);
			const [small, large] = journal.entries;
			assert(small !== undefined && large !== undefined);
			const [smallBytes] = small;
			const [largeBytes, largeChunks] = large;
			expect(largeChunks).toBe(Math.ceil(largeBytes / MiB));
			const register = (handle: string, replayJournal = journal) =>
				gate.register(
					makeOptions(
						parentSpan,
						makeInput(["getCachedValue"], { replayJournal, workflowExecutionId: "lazy-journal" }),
						{},
						makeFiles(),
						handle,
					),
				);
			const read = (
				registration: Effect.Success<ReturnType<typeof register>>,
				seq: number,
				handle: string,
				offset: number,
				length: number,
			) =>
				registration
					.dispatch(makeFrame(seq, "journalRead", { offset, length }, { handle }))
					.pipe(Effect.map(frameValue));

			const tail = yield* register("tail-handle");
			const chunkEnd = smallBytes + MiB;
			const remainder = yield* read(tail, 0, "tail-handle", chunkEnd - 10, MiB);
			expect(remainder).toMatchObject({
				offset: chunkEnd - 10,
				totalBytes: smallBytes + largeBytes,
			});
			assert(typeof remainder === "object" && remainder !== null);
			const data = Reflect.get(remainder, "data");
			assert(typeof data === "string");
			expect(base64DecodedLength(data)).toBe(10);

			const budget = yield* register("budget-handle");
			const fetchedLimit = SANDBOX_LIMITS.journalReads.totalBytes / MiB;
			for (let seq = 0; seq < fetchedLimit; seq += 1) {
				expect(yield* read(budget, seq, "budget-handle", smallBytes, 1)).toMatchObject({
					offset: smallBytes,
				});
			}
			expect(yield* read(budget, fetchedLimit, "budget-handle", smallBytes, 1)).toEqual({
				success: false,
				error: "Sandbox workflow journal read budget exceeded",
			});

			const unavailable = yield* register("unavailable-handle", {
				...journal,
				readChunk: () => Effect.succeed(null),
			});
			expect(yield* read(unavailable, 0, "unavailable-handle", 0, MiB)).toEqual({
				success: false,
				error: "Sandbox workflow journal projection is unavailable",
			});
			expect(yield* read(unavailable, 1, "unavailable-handle", smallBytes + largeBytes, 1)).toEqual(
				{ success: false, error: "Sandbox workflow journal range is outside its pinned prefix" },
			);
		}).pipe(Effect.withSpan("host-call-gate.lazy-journal")),
	);
});
