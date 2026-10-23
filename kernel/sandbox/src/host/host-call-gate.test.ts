import { assert, expect, it, layer } from "@effect/vitest";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { hostFailure, hostSuccess } from "@ryot-app/plugin-backend-sdk/wire";
import {
	type WorkflowDurableResult,
	workflowHostRequestSchema,
	workflowReplayJournalEntrySchema,
} from "@ryot-app/plugin-backend-sdk/workflow";
import {
	Cause,
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
	Tracer,
} from "effect";
import { TestClock } from "effect/testing";

import { makeSidecarFrameWriter } from "../protocol/framing";
import { MiB, SANDBOX_LIMITS } from "../protocol/limits";
import type { SidecarHostResultFrame } from "../protocol/messages";
import { base64DecodedLength, SidecarHostCallFrame } from "../protocol/messages";
import { SandboxSidecarAdmission } from "./admission";
import type { SandboxFileAccess } from "./file-access";
import { makeFiles, makeSandboxAdmission, sandboxGateLayer } from "./gate.test-support";
import { encodeJson, hostCallArgs } from "./host-call-args.test-support";
import {
	SandboxHostCallGate,
	type SandboxHostCallGateOptions,
	type SandboxHostResultDelivery,
} from "./host-call-gate";
import type { BoundHostFunction, SandboxRunInput } from "./invocation";
import { SANDBOX_JSON_GRAPH_FACTOR } from "./json-bytes";
import type { SandboxPinnedJournal } from "./pinned-journal";
import { memoryPinnedJournal } from "./pinned-journal.test-support";
import { makeUserRunInput, makeUserSubject } from "./run-input.test-support";
import { SANDBOX_TRANSIENT_MEMORY } from "./transient-memory";

type HostCallFrame = typeof SidecarHostCallFrame.Type;
type HostResultFrame = typeof SidecarHostResultFrame.Type;
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
	options: Partial<
		Pick<SandboxRunInput, "lane" | "workflowExecutionId" | "replayJournal" | "inlineDurableHost">
	> = {},
): SandboxRunInput =>
	makeUserRunInput({
		lane: "background",
		executionId: "gate-execution",
		principal: {
			subject: makeUserSubject(userId),
			scriptId: SandboxScriptId.make("gate-script"),
			metadata: { capabilities, kind: "workflow", runtimeImports: [] },
		},
		...options,
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

const gateParentSpan = Tracer.externalSpan({ spanId: "gate-test", traceId: "gate-test" });

const makeOptions = (
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
	apiFunctions,
	parentSpan: gateParentSpan,
});

const cachedValueRequest = (index: number) =>
	Schema.decodeSync(workflowHostRequestSchema)({
		index,
		kind: "host",
		name: "getCachedValue",
		args: { args: [], capability: "getCachedValue" },
	});

const gateLayer = Layer.mergeAll(sandboxGateLayer(), TestClock.layer());

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
			cancel: () => Effect.void,
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
				const ordinaryStarted = yield* Deferred.make<void>();
				const releaseOrdinary = yield* Deferred.make<void>();
				const settlementStarted = yield* Deferred.make<void>();
				const releaseSettlement = yield* Deferred.make<void>();
				const result: WorkflowDurableResult = { value: null, state: "success" };
				const input = makeInput(["getCachedValue"], {
					replayJournal: memoryPinnedJournal([]),
					workflowExecutionId: "budget-workflow",
					inlineDurableHost: {
						cancel: () => Effect.void,
						capabilities: ["getCachedValue"],
						settle: (requests) =>
							Deferred.succeed(settlementStarted, undefined).pipe(
								Effect.andThen(Deferred.await(releaseSettlement)),
								Effect.as(requests.map(() => result)),
							),
					},
				});
				const registration = yield* gate.register(
					makeOptions(input, {
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
		),
	);
	test.effect("refuses user settings writes beyond the per-execution cap", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
			let writes = 0;
			const registration = yield* gate.register(
				makeOptions(
					makeInput(["updateUserSettings"]),
					{
						updateUserSettings: successHostFunction(() => {
							writes += 1;
							return { saved: true };
						}),
					},
					makeFiles(),
					"settings-writes",
				),
			);
			const responses = yield* Effect.forEach(
				Array.from({ length: SANDBOX_LIMITS.hostCalls.userSettingsWrites + 1 }, (_, seq) => seq),
				(seq) =>
					registration.dispatch(
						makeFrame(seq, "updateUserSettings", [{ enabled: true }], {
							handle: "settings-writes",
						}),
					),
			);
			const [rejected] = responses.slice(-1);
			assert(rejected);
			expect(writes).toBe(SANDBOX_LIMITS.hostCalls.userSettingsWrites);
			expect(responses.slice(0, -1).map(frameValue)).toEqual(
				Array.from({ length: SANDBOX_LIMITS.hostCalls.userSettingsWrites }, () => ({
					success: true,
					data: { saved: true },
				})),
			);
			expect(frameValue(rejected)).toMatchObject({
				success: false,
				error: "Sandbox execution exceeds 4 updateUserSettings calls",
				data: { code: "execution-limit", operation: "updateUserSettings" },
			});
		}),
	);
	test.effect("preserves host call session protections", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
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
		}),
	);

	test.effect("keeps inline records host-owned and carries them through committed replay", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
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
					cancel: () => Effect.void,
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
				makeOptions(input, {}, makeFiles(), "inline-handle"),
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

			const externalCopy = decodeUnknownJson(encodeJson(inlineEntries[0]));
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
				makeOptions(committedInput, {}, makeFiles(), "replay-handle"),
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
		}),
	);

	test.effect("defers an over-budget inline batch and still charges it", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
			let settlements = 0;
			const input = makeInput(["httpCall"], {
				replayJournal: memoryPinnedJournal([]),
				workflowExecutionId: "gate-budget-workflow",
				inlineDurableHost: {
					cancel: () => Effect.void,
					capabilities: ["httpCall"],
					settle: (requests) =>
						Effect.sync(() => {
							settlements += 1;
							return requests.map(() => ({ value: null, state: "success" as const }));
						}),
				},
			});
			const registration = yield* gate.register(
				makeOptions(input, { httpCall: successHostFunction() }, makeFiles(), "budget"),
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
		}),
	);
});

layer(gateLayer)((test) => {
	test.effect("holds permits for the maximum result size until the reply is written", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const registration = yield* gate.register(
					makeOptions(
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
				expect(gate.transientMemory("background")).toMatchObject({
					waiting: 0,
					used: 4 * ordinary,
				});

				const blocked = yield* registration
					.dispatch(permitFrame(4), replies.deliver)
					.pipe(Effect.forkScoped);
				yield* Effect.yieldNow;
				expect(gate.transientMemory("background")).toMatchObject({
					waiting: 1,
					used: 4 * ordinary,
				});
				replies.written.shift()?.();
				yield* Fiber.join(blocked);
				expect(gate.transientMemory("background")).toMatchObject({
					waiting: 0,
					used: 4 * ordinary,
				});
				for (const released of replies.written.splice(0)) {
					released();
				}
				expect(gate.transientMemory("background")).toMatchObject({ used: 0, waiting: 0 });
			}),
		),
	);

	test.effect("decodes host call arguments under a transient permit", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const registration = yield* gate.register(
					makeOptions(
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
				expect(gate.transientMemory("background").waiting).toBe(1);
				for (const released of replies.written.splice(0)) {
					released();
				}
				expect(frameValue(yield* Fiber.join(waiting))).toMatchObject({
					success: false,
					error: "Sandbox host call arguments are invalid",
				});
				expect(gate.transientMemory("background")).toMatchObject({ used: 0, waiting: 0 });
			}),
		),
	);

	test.effect("never leaks permits when a dispatch is interrupted at any point", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
			for (const yieldBudget of [3, 8]) {
				for (let yields = 0; yields < 40; yields += 1) {
					const scope = yield* Scope.make();
					const registration = yield* gate
						.register(
							makeOptions(makeInput(["getCachedValue"]), undefined, makeFiles(), "interrupted"),
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
					expect(gate.transientMemory("background")).toMatchObject({ used: 0, waiting: 0 });
				}
			}
		}),
	);

	test.effect("releases permits of cancelled host calls after native completion", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
			const started = yield* Deferred.make<void>();
			const finish = yield* Deferred.make<void>();
			const scope = yield* Scope.make();
			const registration = yield* gate
				.register(
					makeOptions(
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
			expect(gate.transientMemory("background")).toMatchObject({
				waiting: 0,
				used: permitBytes(frame, SANDBOX_TRANSIENT_MEMORY.smallBytes),
			});
			expect(closing.pollUnsafe()).toBeUndefined();
			yield* Deferred.succeed(finish, undefined);
			yield* Fiber.join(closing);
			expect(frameValue(yield* Fiber.join(call))).toMatchObject({ success: false });
			expect(gate.transientMemory("background")).toMatchObject({ used: 0, waiting: 0 });
		}),
	);

	test.effect(
		"reserves inline batches before settlement and defers them without side effects",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const gate = yield* SandboxHostCallGate;
					const settled = { count: 0 };
					const registration = yield* gate.register(
						makeOptions(
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
							makeFrame(seq, "httpCall", ["GET", "https://example.com/held"], {
								handle: "reserve",
							}),
							replies.deliver,
						);
					}
					expect(frameValue(yield* registration.dispatch(reserveBatch(2)))).toEqual({
						defer: true,
					});
					expect(settled.count).toBe(0);

					for (const released of replies.written.splice(0)) {
						released();
					}
					expect(frameValue(yield* registration.dispatch(reserveBatch(3)))).toEqual({
						results: [{ value: null, state: "success" }],
					});
					expect(settled.count).toBe(1);
				}),
			),
	);

	test.effect("bounds held inline results before settlement", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const settled = { count: 0 };
				const registration = yield* gate.register(
					makeOptions(
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
				expect(frameValue(yield* batch(2, httpRequests(allowance)))).toEqual({ defer: true });
				expect(settled.count).toBe(0);
				expect(frameValue(yield* batch(3, httpRequests(1)))).toMatchObject({
					results: [{ value: null, state: "success" }],
				});
				expect(settled.count).toBe(1);
			}),
		),
	);

	test.effect("defers before settlement when inline evidence is exhausted", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
			const settled = { count: 0 };
			const value = "x".repeat(9 * MiB);
			const scope = yield* Scope.make();
			const registration = yield* gate
				.register(
					makeOptions(
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
				.reduce((sum, entry) => sum + new TextEncoder().encode(encodeJson(entry)).byteLength, 0);
			expect(gate.transientMemory("background")).toMatchObject({
				waiting: 0,
				used: SANDBOX_TRANSIENT_MEMORY.evidenceCopies * evidence,
			});

			expect(frameValue(yield* batch(4))).toEqual({ defer: true });
			expect(settled.count).toBe(4);
			yield* Scope.close(scope, Exit.void);
			expect(gate.transientMemory("background")).toMatchObject({ used: 0, waiting: 0 });
		}),
	);
	test.effect("charges fetched chunks on lazy journal reads and fails closed", () =>
		Effect.gen(function* () {
			const gate = yield* SandboxHostCallGate;
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
		}),
	);
});

const gateFor = (admission: SandboxSidecarAdmission["Service"]) =>
	SandboxHostCallGate.make.pipe(Effect.provideService(SandboxSidecarAdmission, admission));

const enterLazy = (
	admission: SandboxSidecarAdmission["Service"],
	instance: string,
	generation: number,
	lane: ExecutionLane,
) =>
	Effect.gen(function* () {
		const lease = yield* admission.reserveRun(instance, lane);
		yield* admission.reserveProcess(instance, generation, lease);
		yield* lease.enter({ lane, instance, generation });
	});

const maximumJournal: SandboxPinnedJournal = {
	fault: () => undefined,
	bytes: 8 * 12 * MiB + 9,
	readChunk: () => Effect.succeed(new Uint8Array(MiB)),
	entries: Array.from({ length: 8 }, (_, index) => [12 * MiB, 12, String(index)] as const),
};

const decodeFrameHandle = Schema.decodeUnknownSync(
	Schema.fromJsonString(Schema.Struct({ handle: Schema.String })),
);

it.effect("keeps existing execution limits under interactive memory headroom", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const admission = yield* makeSandboxAdmission(1452, 3);
			const gate = yield* gateFor(admission);
			yield* enterLazy(admission, "user/data", 1, "background");
			const background = yield* gate.register(
				makeOptions(
					makeInput(["httpCall"], {
						lane: "background",
						replayJournal: maximumJournal,
						workflowExecutionId: "headroom-background",
					}),
					{ httpCall: successHostFunction() },
					makeFiles(),
					"background",
				),
			);
			const replies = holdReplies();
			yield* background.dispatch(
				makeFrame(0, "httpCall", ["GET", "https://example.com/maximum"], { handle: "background" }),
				replies.deliver,
			);
			yield* background.dispatch(
				makeFrame(1, "journalRead", { offset: 0, length: MiB }, { handle: "background" }),
				replies.deliver,
			);
			expect(replies.written).toHaveLength(2);
			const backgroundMemory = gate.transientMemory("background");
			const secondAdmitted = yield* Deferred.make<void>();
			yield* Effect.scoped(
				admission
					.reserveRun("user/full", "background")
					.pipe(Effect.andThen(Deferred.succeed(secondAdmitted, undefined))),
			).pipe(Effect.forkScoped({ startImmediately: true }));
			yield* Effect.yieldNow;
			expect(admission.snapshot().waiting).toBe(1);

			yield* enterLazy(admission, "user/full", 2, "interactive");
			const interactive = yield* gate.register(
				makeOptions(
					makeInput(["httpCall"], { lane: "interactive" }),
					{ httpCall: successHostFunction() },
					makeFiles(),
					"interactive",
				),
			);
			const reply = yield* interactive.dispatch(
				makeFrame(0, "httpCall", ["GET", "https://example.com/interactive"], {
					handle: "interactive",
				}),
			);
			expect(frameValue(reply)).toEqual(hostSuccess("GET"));
			expect(gate.transientMemory("interactive")).toMatchObject({ used: 0, waiting: 0 });
			expect(gate.transientMemory("background")).toEqual(backgroundMemory);
			expect(admission.snapshot()).toMatchObject({
				runs: 2,
				waiting: 1,
				bytes: admission.plan.budget,
			});
			expect(yield* Deferred.isDone(secondAdmitted)).toBe(false);
			for (const released of replies.written.splice(0)) {
				released();
			}
		}),
	),
);

it.effect("settles an interactive inline batch at the lane edge", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const admission = yield* makeSandboxAdmission(1452, 3);
			expect(admission.plan.mode).toBe("lane");
			const gate = yield* gateFor(admission);
			yield* enterLazy(admission, "user/data", 1, "interactive");
			const settled = { count: 0 };
			const registration = yield* gate.register(
				makeOptions(
					makeInput(["httpCall"], {
						lane: "interactive",
						replayJournal: memoryPinnedJournal([]),
						workflowExecutionId: "interactive-inline",
						inlineDurableHost: {
							cancel: () => Effect.void,
							capabilities: ["httpCall"],
							settle: (requests) =>
								Effect.sync(() => {
									settled.count += 1;
									return requests.map((): WorkflowDurableResult => ({
										value: null,
										state: "success",
									}));
								}),
						},
					}),
					{ httpCall: successHostFunction() },
					makeFiles(),
					"interactive-inline",
				),
			);
			expect(
				frameValue(
					yield* registration.dispatch(
						makeFrame(
							0,
							"inlineBatch",
							{ requests: httpRequests(1) },
							{ handle: "interactive-inline" },
						),
					),
				),
			).toEqual({ results: [{ value: null, state: "success" }] });
			expect(settled.count).toBe(1);
		}),
	),
);

it.effect(
	"progresses interactive host calls while background transient capacity is exhausted",
	() =>
		Effect.scoped(
			Effect.gen(function* () {
				const admission = yield* makeSandboxAdmission(1904, 3);
				const gate = yield* gateFor(admission);
				const lanes = new Map<string, ExecutionLane>([
					["inline", "background"],
					["results", "background"],
					["interactive", "interactive"],
				]);
				const written: string[] = [];
				let writable = Number.POSITIVE_INFINITY;
				const writer = makeSidecarFrameWriter({
					maximumRunMessages: 2,
					maximumControlMessages: 16,
					maximumQueuedBytes: 64 * MiB,
					lane: (handle) => lanes.get(handle),
					write: (bytes) => {
						written.push(decodeFrameHandle(new TextDecoder().decode(bytes.subarray(4))).handle);
						writable -= 1;
						return { blocked: writable <= 0, written: bytes.byteLength };
					},
				});
				const deliver: SandboxHostResultDelivery = (reply, released) =>
					Effect.sync(() => writer.enqueue(reply, released));
				const settlementStarted = yield* Deferred.make<void>();
				const releaseSettlement = yield* Deferred.make<void>();
				const inline = yield* gate.register(
					makeOptions(
						makeInput(["httpCall"], {
							lane: "background",
							replayJournal: memoryPinnedJournal([]),
							workflowExecutionId: "exhausted-inline",
							inlineDurableHost: {
								cancel: () => Effect.void,
								capabilities: ["httpCall"],
								settle: (requests) =>
									Deferred.succeed(settlementStarted, undefined).pipe(
										Effect.andThen(Deferred.await(releaseSettlement)),
										Effect.as(
											requests.map((): WorkflowDurableResult => ({
												value: null,
												state: "success",
											})),
										),
									),
							},
						}),
						{},
						makeFiles(),
						"inline",
					),
				);
				const settling = yield* inline
					.dispatch(
						makeFrame(0, "inlineBatch", { requests: httpRequests(1) }, { handle: "inline" }),
					)
					.pipe(Effect.forkScoped);
				yield* Deferred.await(settlementStarted);
				const maximum = "x".repeat(SANDBOX_LIMITS.bridge.responseBytes - 1024);
				const results = yield* gate.register(
					makeOptions(
						makeInput(["httpCall"], { lane: "background" }),
						{ httpCall: () => Effect.succeed(hostSuccess(maximum)) },
						makeFiles(),
						"results",
					),
				);
				yield* results.dispatch(
					makeFrame(0, "httpCall", ["GET", "https://example.com/first"], { handle: "results" }),
					deliver,
				);
				const blocked = yield* results
					.dispatch(
						makeFrame(1, "httpCall", ["GET", "https://example.com/second"], { handle: "results" }),
						deliver,
					)
					.pipe(Effect.forkScoped);
				yield* Effect.yieldNow;
				expect(gate.transientMemory("background")).toMatchObject({ waiting: 1 });
				writable = 1;
				writer.flush();
				expect(written).toEqual(["results"]);

				const interactive = yield* gate.register(
					makeOptions(
						makeInput(["httpCall"], {
							lane: "interactive",
							workflowExecutionId: "exhausted-interactive",
							replayJournal: memoryPinnedJournal([
								{ value: "x".repeat(2 * MiB), request: cachedValueRequest(0) },
							]),
						}),
						{ httpCall: successHostFunction() },
						makeFiles(),
						"interactive",
					),
				);
				yield* interactive.dispatch(
					makeFrame(0, "httpCall", ["GET", "https://example.com/interactive"], {
						handle: "interactive",
					}),
					deliver,
				);
				yield* interactive.dispatch(
					makeFrame(1, "journalRead", { offset: 0, length: MiB }, { handle: "interactive" }),
					deliver,
				);
				expect(gate.transientMemory("interactive").used).toBeGreaterThan(0);
				expect(gate.transientMemory("background")).toMatchObject({ waiting: 1 });
				writable = Number.POSITIVE_INFINITY;
				writer.flush();
				const first = written.indexOf("interactive");
				const last = written.lastIndexOf("interactive");
				expect(first).toBe(1);
				expect(written.slice(first, last + 1).join(",")).not.toContain("results,results");
				expect(gate.transientMemory("interactive")).toMatchObject({ used: 0, waiting: 0 });

				yield* Deferred.succeed(releaseSettlement, undefined);
				yield* Fiber.join(settling);
				yield* Fiber.join(blocked);
				writer.flush();
				expect(gate.transientMemory("background")).toMatchObject({ waiting: 0 });
			}),
		),
);

it.effect("keeps escaped host results within their transient permits", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const admission = yield* makeSandboxAdmission(1904);
			const gate = yield* gateFor(admission);
			const limit = SANDBOX_LIMITS.bridge.responseBytes;
			let body = "";
			const registration = yield* gate.register(
				makeOptions(
					makeInput(["httpCall"], { lane: "interactive" }),
					{ httpCall: () => Effect.succeed(hostSuccess(body)) },
					makeFiles(),
					"escaped",
				),
			);
			const replies = holdReplies();
			const oversized = hostFailure(`Sandbox bridge response exceeds ${limit} UTF-8 bytes`);
			for (const [seq, { text, accepted }] of [
				{ accepted: false, text: "\u0001".repeat(Math.ceil(limit / 6)) },
				{ accepted: false, text: "\ud800".repeat(Math.ceil(limit / 6)) },
				{ accepted: false, text: "\ufffd".repeat(Math.ceil(limit / 3)) },
				{ accepted: true, text: "\u0001".repeat(Math.floor(limit / 6) - 16) },
			].entries()) {
				body = text;
				const frame = permitFrame(seq);
				const reply = yield* registration.dispatch(
					makeFrame(seq, "httpCall", ["GET", "https://example.com/permit"], { handle: "escaped" }),
					replies.deliver,
				);
				expect(frameValue(reply)).toEqual(accepted ? hostSuccess(text) : oversized);
				expect(gate.transientMemory("interactive").used).toBe(
					permitBytes(frame, SANDBOX_TRANSIENT_MEMORY.ordinaryBytes),
				);
				expect(gate.transientMemory("interactive").used).toBeLessThanOrEqual(
					admission.plan.pools.interactive,
				);
				replies.written.shift()?.();
			}
			expect(gate.transientMemory("interactive")).toMatchObject({ used: 0, waiting: 0 });
		}),
	),
);

it.effect("sizes transient pools from the admission memory plan", () =>
	Effect.scoped(
		Effect.gen(function* () {
			for (const budget of [1094, 1904]) {
				const admission = yield* makeSandboxAdmission(budget);
				const gate = yield* gateFor(admission);
				expect([
					gate.transientMemory("interactive").capacity,
					gate.transientMemory("background").capacity,
				]).toEqual([admission.plan.pools.interactive, admission.plan.pools.background]);
				const registration = yield* gate.register(
					makeOptions(
						makeInput(["httpCall"], { lane: "background" }),
						{ httpCall: successHostFunction() },
						makeFiles(),
						`wiring-${budget}`,
					),
				);
				const replies = holdReplies();
				yield* registration.dispatch(
					makeFrame(0, "httpCall", ["GET", "https://example.com/permit"], {
						handle: `wiring-${budget}`,
					}),
					replies.deliver,
				);
				const background = gate.transientMemory("background").used;
				expect(gate.transientMemory("interactive").used).toBe(
					admission.plan.mode === "shared" ? background : 0,
				);
				replies.written.shift()?.();
			}
		}),
	),
);

const recordingCancel = () => {
	const cancelled: Array<number> = [];
	const cancel = (pending: ReadonlyArray<unknown>) =>
		Effect.sync(() => {
			cancelled.push(pending.length);
		});
	return { cancel, cancelled };
};

const closeableInput = (cancel: NonNullable<SandboxRunInput["inlineDurableHost"]>["cancel"]) =>
	makeInput(["getCachedValue"], {
		workflowExecutionId: "close-workflow",
		replayJournal: memoryPinnedJournal([]),
		inlineDurableHost: {
			cancel,
			capabilities: ["getCachedValue"],
			settle: (requests) =>
				Effect.succeed(
					requests.map((): WorkflowDurableResult => ({ value: null, state: "success" })),
				),
		},
	});

const singleInlineBatch = (seq: number) =>
	makeFrame(seq, "inlineBatch", { requests: [cachedValueRequest(0)] });

const closeLifecycle = (handoff: boolean) =>
	Effect.gen(function* () {
		const gate = yield* SandboxHostCallGate;
		const started = yield* Deferred.make<void>();
		const recorded = recordingCancel();
		const registration = yield* gate.register(
			makeOptions(
				closeableInput(recorded.cancel),
				{
					getCachedValue: () =>
						Deferred.succeed(started, undefined).pipe(
							Effect.andThen(Effect.never),
							Effect.as(hostSuccess(null)),
						),
				},
				makeFiles(),
				"closing",
			),
		);
		const batch = yield* registration.dispatch(
			makeFrame(0, "inlineBatch", { requests: [cachedValueRequest(0)] }, { handle: "closing" }),
		);
		expect(frameValue(batch)).toEqual({ results: [{ value: null, state: "success" }] });
		expect(registration.inlineEntries()).toHaveLength(1);
		const inFlight = yield* registration
			.dispatch(makeFrame(1, "getCachedValue", [], { handle: "closing" }))
			.pipe(Effect.forkChild);
		yield* Deferred.await(started);
		if (handoff) {
			registration.handoff();
		}
		yield* registration.close;
		yield* registration.close;
		const afterClose = yield* registration.dispatch(
			makeFrame(2, "getCachedValue", [], { handle: "closing" }),
		);
		return { gate, recorded, afterClose, registration, inFlight: yield* Fiber.join(inFlight) };
	});

layer(gateLayer)((test) => {
	test.effect("cancels in-flight work and clears evidence when closed without handoff", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const { gate, recorded, inFlight, afterClose, registration } = yield* closeLifecycle(false);
				expect(recorded.cancelled).toEqual([0]);
				expect(frameValue(inFlight)).toMatchObject({
					success: false,
					error: "Sandbox execution is no longer active",
				});
				expect(frameValue(afterClose)).toMatchObject({
					success: false,
					error: "Sandbox execution is no longer active",
				});
				expect(registration.inlineEntries()).toEqual([]);
				expect(registration.pendingEntries()).toEqual([]);
				expect(yield* registration.scriptBudget).toMatchObject({ remainingMs: 0 });
				expect(gate.transientMemory("background").used).toBeGreaterThan(0);
				return gate;
			}),
		).pipe(
			Effect.tap((gate) =>
				Effect.sync(() => {
					expect(gate.transientMemory("background")).toMatchObject({ used: 0, waiting: 0 });
				}),
			),
		),
	);

	test.effect("does not cancel after handoff but still clears evidence on close", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const { gate, recorded, inFlight, afterClose, registration } = yield* closeLifecycle(true);
				expect(recorded.cancelled).toEqual([]);
				expect(frameValue(inFlight)).toMatchObject({
					success: false,
					error: "Sandbox execution is no longer active",
				});
				expect(frameValue(afterClose)).toMatchObject({ success: false });
				expect(registration.inlineEntries()).toEqual([]);
				expect(gate.transientMemory("background").used).toBeGreaterThan(0);
				return gate;
			}),
		).pipe(
			Effect.tap((gate) =>
				Effect.sync(() => {
					expect(gate.transientMemory("background")).toMatchObject({ used: 0, waiting: 0 });
				}),
			),
		),
	);

	test.effect("accepts only validated settlement time extensions and none after close", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const registration = yield* gate.register(makeOptions(makeInput()));
				for (const ms of [1, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
					const exit = yield* Effect.exit(registration.extend(ms));
					expect(exit._tag).toBe("Failure");
				}
				yield* registration.extend(0);
				yield* registration.close;
				expect((yield* Effect.exit(registration.extend(0)))._tag).toBe("Failure");
			}),
		),
	);

	test.effect("expires one millisecond after the initial window and closes", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const recorded = recordingCancel();
				const registration = yield* gate.register(
					makeOptions(
						closeableInput(recorded.cancel),
						{ getCachedValue: successHostFunction() },
						makeFiles(),
					),
				);
				yield* TestClock.adjust(
					Duration.millis(SANDBOX_LIMITS.execution.timeoutMs + SANDBOX_LIMITS.sidecar.disposalMs),
				);
				const atEdge = yield* registration.dispatch(makeFrame(0, "getCachedValue", ["edge"]));
				expect(frameValue(atEdge)).toMatchObject({ data: "edge", success: true });
				expect(recorded.cancelled).toEqual([]);
				yield* TestClock.adjust("1 millis");
				const expired = yield* registration.dispatch(makeFrame(1, "getCachedValue", ["late"]));
				expect(frameValue(expired)).toMatchObject({
					success: false,
					error: "Sandbox execution expired",
				});
				expect(recorded.cancelled).toEqual([0]);
				const closed = yield* registration.dispatch(makeFrame(2, "getCachedValue", ["after"]));
				expect(frameValue(closed)).toMatchObject({
					success: false,
					error: "Sandbox execution is no longer active",
				});
			}),
		),
	);

	test.effect("routes file control calls through the file session", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const reads: Array<unknown> = [];
				const writes: Array<unknown> = [];
				const registration = yield* gate.register(
					makeOptions(
						makeInput(),
						{ getCachedValue: successHostFunction() },
						makeFiles(
							(args) =>
								Effect.sync(() => {
									reads.push(args);
									return { size: 7, data: "", offset: args.offset };
								}),
							(args) =>
								Effect.sync(() => {
									writes.push(args);
									return null;
								}),
						),
					),
				);
				const read = yield* registration.dispatch(
					makeFrame(0, "artifactReadRange", { length: 2, offset: 3, key: "named" }),
				);
				expect(frameValue(read)).toEqual({ size: 7, data: "", offset: 3 });
				expect(reads).toEqual([{ length: 2, offset: 3, key: "named" }]);
				const write = yield* registration.dispatch(
					makeFrame(1, "scratchWrite", { data: "", offset: 0, final: true, name: "out" }),
				);
				expect(frameValue(write)).toBeNull();
				expect(writes).toEqual([{ data: "", offset: 0, final: true, name: "out" }]);
				const badRead = yield* registration.dispatch(
					makeFrame(2, "artifactReadRange", { offset: 0, length: "x" }),
				);
				expect(frameValue(badRead)).toMatchObject({
					success: false,
					error: "Sandbox artifact range arguments are invalid",
				});
				const badWrite = yield* registration.dispatch(makeFrame(3, "scratchWrite", { offset: 0 }));
				expect(frameValue(badWrite)).toMatchObject({
					success: false,
					error: "Sandbox scratch write arguments are invalid",
				});
				expect(reads).toHaveLength(1);
				expect(writes).toHaveLength(1);
			}),
		),
	);

	test.effect("rejects malformed file control arguments before reaching the file session", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				let reads = 0;
				let writes = 0;
				const registration = yield* gate.register(
					makeOptions(
						makeInput(),
						{ getCachedValue: successHostFunction() },
						makeFiles(
							(args) =>
								Effect.sync(() => {
									reads += 1;
									return { size: 0, data: "", offset: args.offset };
								}),
							() =>
								Effect.sync(() => {
									writes += 1;
									return null;
								}),
						),
					),
				);
				const write = { data: "", offset: 0, final: true, name: "out" };
				const oversized = Buffer.alloc(SANDBOX_LIMITS.scratch.chunkBytes + 1).toString("base64");
				const rejectedReads = [
					{ offset: 0, length: 1, extra: true },
					{ offset: 0, length: 0 },
					{ offset: 0, length: MiB + 1 },
					{ offset: 0, length: 1.5 },
					{ length: 1, offset: -1 },
					{ key: 7, offset: 0, length: 1 },
				];
				const rejectedWrites = [
					{ ...write, extra: true },
					{ ...write, data: "not base64!" },
					{ ...write, data: oversized },
					{ ...write, offset: -1 },
					{ ...write, offset: 0.5 },
					{ ...write, name: 7 },
				];
				for (const [index, args] of rejectedReads.entries()) {
					const reply = yield* registration.dispatch(makeFrame(index, "artifactReadRange", args));
					expect(frameValue(reply)).toMatchObject({
						success: false,
						error: "Sandbox artifact range arguments are invalid",
					});
				}
				for (const [index, args] of rejectedWrites.entries()) {
					const reply = yield* registration.dispatch(
						makeFrame(rejectedReads.length + index, "scratchWrite", args),
					);
					expect(frameValue(reply)).toMatchObject({
						success: false,
						error: "Sandbox scratch write arguments are invalid",
					});
				}
				expect({ reads, writes }).toEqual({ reads: 0, writes: 0 });
			}),
		),
	);

	test.effect("releases permits and propagates when a dispatch is interrupted mid host call", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const started = yield* Deferred.make<void>();
				let hung = true;
				const registration = yield* gate.register(
					makeOptions(makeInput(["getCachedValue"]), {
						getCachedValue: () =>
							hung
								? Deferred.succeed(started, undefined).pipe(
										Effect.andThen(Effect.never),
										Effect.as(hostSuccess(null)),
									)
								: Effect.succeed(hostSuccess("after")),
					}),
				);
				const call = yield* registration
					.dispatch(makeFrame(0, "getCachedValue", []))
					.pipe(Effect.forkChild);
				yield* Deferred.await(started);
				expect(gate.transientMemory("background").used).toBeGreaterThan(0);
				yield* Fiber.interrupt(call);
				const exit = yield* Fiber.await(call);
				expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
				expect(gate.transientMemory("background")).toMatchObject({ used: 0, waiting: 0 });
				hung = false;
				const next = yield* registration.dispatch(makeFrame(1, "getCachedValue", []));
				expect(frameValue(next)).toMatchObject({ success: true, data: "after" });
			}),
		),
	);

	test.effect("turns non-interrupt causes into failure frames and re-raises interrupts", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const registration = yield* gate.register(
					makeOptions(makeInput(["getCachedValue", "httpCall", "listIntegrations"]), {
						httpCall: () => Effect.interrupt,
						getCachedValue: () => Effect.die(new Error("secret defect")),
						listIntegrations: () => {
							throw new Error("secret throw");
						},
					}),
				);
				const died = yield* registration.dispatch(makeFrame(0, "getCachedValue", []));
				expect(frameValue(died)).toEqual({ success: false, error: "Sandbox host call failed" });
				const thrown = yield* registration.dispatch(makeFrame(1, "listIntegrations", []));
				expect(frameValue(thrown)).toMatchObject({ success: false });
				expect(encodeJson(frameValue(thrown))).not.toContain("secret");
				const interrupted = yield* Effect.exit(
					registration.dispatch(makeFrame(2, "httpCall", ["GET", "https://example.com/x"])),
				);
				expect(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause)).toBe(true);
				expect(gate.transientMemory("background")).toMatchObject({ used: 0, waiting: 0 });
			}),
		),
	);

	test.effect("defers inline settlement defects and propagates settlement interrupts", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				let mode: "die" | "interrupt" = "die";
				const input = makeInput(["getCachedValue"], {
					workflowExecutionId: "settle-workflow",
					replayJournal: memoryPinnedJournal([]),
					inlineDurableHost: {
						cancel: () => Effect.void,
						capabilities: ["getCachedValue"],
						settle: () => (mode === "die" ? Effect.die(new Error("boom")) : Effect.interrupt),
					},
				});
				const registration = yield* gate.register(makeOptions(input));
				const deferred = yield* registration.dispatch(singleInlineBatch(0));
				expect(frameValue(deferred)).toEqual({ defer: true });
				mode = "interrupt";
				const interrupted = yield* Effect.exit(registration.dispatch(singleInlineBatch(1)));
				expect(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause)).toBe(true);
				expect(registration.inlineEntries()).toEqual([]);
				expect(gate.transientMemory("background")).toMatchObject({ used: 0, waiting: 0 });
			}),
		),
	);

	test.effect("rejects a pinned journal with more entries than the host call limit", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const journal: SandboxPinnedJournal = {
					...memoryPinnedJournal([]),
					entries: Array.from(
						{ length: SANDBOX_LIMITS.hostCalls.total + 1 },
						(_, index) => [0, 0, String(index)] as const,
					),
				};
				const error = yield* gate
					.register(makeOptions(makeInput(["getCachedValue"], { replayJournal: journal })))
					.pipe(Effect.flip);
				expect(error).toMatchObject({ reason: "Sandbox workflow journal exceeds its byte limit" });
			}),
		),
	);

	test.effect("rejects a pinned journal larger than the journal byte limit", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const journal: SandboxPinnedJournal = {
					...memoryPinnedJournal([]),
					bytes: SANDBOX_LIMITS.journalBytes + 1,
				};
				const error = yield* gate
					.register(makeOptions(makeInput(["getCachedValue"], { replayJournal: journal })))
					.pipe(Effect.flip);
				expect(error).toMatchObject({ reason: "Sandbox workflow journal exceeds its byte limit" });
			}),
		),
	);

	test.effect("rejects a workflow execution without a host-pinned journal prefix", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const error = yield* gate
					.register(makeOptions(makeInput(["getCachedValue"], { workflowExecutionId: "unpinned" })))
					.pipe(Effect.flip);
				expect(error).toMatchObject({
					reason: "Workflow executions require a host-pinned journal prefix",
				});
			}),
		),
	);

	test.effect(
		"keeps neighbour registrations live while closing an owner interrupts active and queued work",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const gate = yield* SandboxHostCallGate;
					const started = yield* Queue.unbounded<void>();
					const interrupted = yield* Queue.unbounded<void>();
					const registered =
						yield* Deferred.make<Effect.Success<ReturnType<typeof gate.register>>>();
					let calls = 0;
					const blockedHost: BoundHostFunction = () =>
						Effect.gen(function* () {
							calls++;
							yield* Queue.offer(started, undefined);
							return yield* Effect.never.pipe(
								Effect.onInterrupt(() => Queue.offer(interrupted, undefined)),
							);
						});
					const owner = yield* Effect.forkChild(
						Effect.scoped(
							Effect.gen(function* () {
								const registration = yield* gate.register(
									makeOptions(makeInput(), { getCachedValue: blockedHost }, makeFiles(), "blocked"),
								);
								yield* Deferred.succeed(registered, registration);
								return yield* Effect.never;
							}),
						),
					);
					const registration = yield* Deferred.await(registered);
					const work = yield* Effect.forEach([0, 1, 2, 3, 4], (seq) =>
						Effect.forkChild(
							registration.dispatch(
								makeFrame(seq, "getCachedValue", ["key"], { handle: "blocked" }),
							),
						),
					);
					yield* Effect.replicateEffect(Queue.take(started), 4);
					const unblocked = successHostFunction(() => "unblocked");
					const neighbour = yield* gate.register(
						makeOptions(makeInput(), { getCachedValue: unblocked }, makeFiles(), "neighbour"),
					);
					const dispatchNeighbour = (seq: number) =>
						neighbour.dispatch(makeFrame(seq, "getCachedValue", ["key"], { handle: "neighbour" }));
					expect(frameValue(yield* dispatchNeighbour(0))).toEqual(hostSuccess("unblocked"));

					yield* Fiber.interrupt(owner);
					yield* Effect.replicateEffect(Queue.take(interrupted), 4);
					const results = yield* Effect.forEach(work, Fiber.join);
					expect(calls).toBe(4);
					for (const result of results) {
						expect(frameValue(result)).toMatchObject({ success: false });
					}
					expect(frameValue(yield* dispatchNeighbour(1))).toEqual(hostSuccess("unblocked"));
				}),
			),
	);

	test.effect("releases every permit after typed failures, defects, and caller interruption", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const started = yield* Queue.unbounded<void>();
				const release = yield* Deferred.make<void>();
				const host: BoundHostFunction = (args) => {
					if (args[0] === "failure") {
						return Effect.fail({ message: "expected typed failure" });
					}
					if (args[0] === "defect") {
						return Effect.die("expected defect");
					}
					if (args[0] === "interrupt") {
						return Queue.offer(started, undefined).pipe(Effect.andThen(Effect.never));
					}
					return Queue.offer(started, undefined).pipe(
						Effect.andThen(Deferred.await(release)),
						Effect.as(hostSuccess("released")),
					);
				};
				const registration = yield* gate.register(
					makeOptions(makeInput(), { getCachedValue: host }, makeFiles(), "exit-permits"),
				);
				const dispatch = (seq: number, mode: string) =>
					registration.dispatch(
						makeFrame(seq, "getCachedValue", [mode], { handle: "exit-permits" }),
					);
				for (let seq = 0; seq < 4; seq++) {
					expect(
						frameValue(yield* dispatch(seq, seq % 2 === 0 ? "failure" : "defect")),
					).toMatchObject({ success: false });
				}
				const cancelled = yield* Effect.forkChild(dispatch(4, "interrupt"));
				yield* Queue.take(started);
				yield* Fiber.interrupt(cancelled);
				const successful = yield* Effect.forEach([5, 6, 7, 8], (seq) =>
					Effect.forkChild(dispatch(seq, "release")),
				);
				yield* Effect.replicateEffect(Queue.take(started), 4);
				yield* Deferred.succeed(release, undefined);
				const results = yield* Effect.forEach(successful, Fiber.join);
				expect(results.map(frameValue)).toEqual(
					Array.from({ length: 4 }, () => hostSuccess("released")),
				);
			}),
		),
	);
});
