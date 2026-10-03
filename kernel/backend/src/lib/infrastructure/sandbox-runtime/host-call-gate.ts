import { isJsonValue } from "@ryot-app/contract/schema/json";
import { utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { hostFailure, jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import {
	workflowDurableResultSchema,
	workflowHostRequestSchema,
	workflowReplayJournalEntrySchema,
	type WorkflowReplayJournalEntry,
} from "@ryot-app/sandbox-sdk/workflow";
import type { Scope, Tracer } from "effect";
import {
	Cause,
	Clock,
	Context,
	Data,
	Deferred,
	Effect,
	Layer,
	Option,
	Schema,
	Semaphore,
} from "effect";
import { Base64 } from "effect/encoding";

import { recordSandboxHostCall, sandboxMetricHostFunction } from "../runtime-metrics";
import { isSandboxCapability } from "./capability-policy";
import type { SandboxFileAccess } from "./file-service";
import { consumeSandboxHostCall, SANDBOX_LIMITS } from "./limits";
import { isSandboxCapabilityAllowed, type BoundHostFunction, type SandboxRunInput } from "./shared";
import {
	artifactReadRangeArgsSchema,
	InlineBatchSchema,
	journalReadArgsSchema,
	scratchWriteArgsSchema,
	SIDECAR_PROTOCOL_LIMITS,
	type SandboxInvocationSchema,
	type SidecarHostCallFrame,
	type SidecarHostResultFrame,
} from "./sidecar-protocol";

const initialExpiryMs = SANDBOX_LIMITS.execution.timeoutMs + SANDBOX_LIMITS.sidecar.disposalMs;
const maximumSequenceCount = SANDBOX_LIMITS.hostCalls.total + SANDBOX_LIMITS.journalReads.count + 4;
const dispatchQueueFull = Symbol("dispatchQueueFull");
const strictOptions = { onExcessProperty: "error" } as const;
const encodeUnknownJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeJournalEntryJson = Schema.encodeSync(
	Schema.fromJsonString(workflowReplayJournalEntrySchema),
	strictOptions,
);
const decodeJournalEntryJson = Schema.decodeSync(
	Schema.fromJsonString(workflowReplayJournalEntrySchema),
	strictOptions,
);
const encodeHostRequestJson = Schema.encodeSync(
	Schema.fromJsonString(workflowHostRequestSchema),
	strictOptions,
);
const decodeHostRequestJson = Schema.decodeSync(
	Schema.fromJsonString(workflowHostRequestSchema),
	strictOptions,
);
const decodeJournalEntry = Schema.decodeUnknownSync(
	workflowReplayJournalEntrySchema,
	strictOptions,
);
const decodeJournalPrefixEntry = Schema.decodeUnknownEffect(
	workflowReplayJournalEntrySchema,
	strictOptions,
);
const decodeJournalReadArgs = Schema.decodeUnknownOption(journalReadArgsSchema, strictOptions);
const decodeInlineBatch = Schema.decodeUnknownOption(InlineBatchSchema, strictOptions);
const decodeHostCallArgs = Schema.decodeUnknownOption(Schema.Array(jsonValueSchema), strictOptions);
const decodeArtifactReadRangeArgs = Schema.decodeUnknownOption(
	artifactReadRangeArgsSchema,
	strictOptions,
);
const decodeScratchWriteArgs = Schema.decodeUnknownOption(scratchWriteArgsSchema, strictOptions);
const decodeSidecarJson = Schema.decodeUnknownOption(Schema.Json, strictOptions);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const encodeJsonBytes = (value: unknown) => encoder.encode(encodeUnknownJson(value));
const failureMessage = "Sandbox host call failed";

type SidecarHostCallFrameType = typeof SidecarHostCallFrame.Type;
type SidecarHostResultFrameType = typeof SidecarHostResultFrame.Type;
type SandboxInvocationJournal = (typeof SandboxInvocationSchema.Type)["journal"];
const scriptBudgetSchema = Schema.Struct({ settledMs: Schema.Finite, remainingMs: Schema.Finite });

export class GateError extends Data.TaggedError("SandboxHostCallGateError")<{
	readonly reason: string;
}> {}

export type SandboxHostCallGateOptions = {
	readonly instance: string;
	readonly generation: number;
	readonly handle: string;
	readonly input: SandboxRunInput;
	readonly apiFunctions: Readonly<Record<string, BoundHostFunction>>;
	readonly files: SandboxFileAccess;
	readonly parentSpan: Tracer.AnySpan;
};

export type SandboxHostCallGateRegistration = {
	readonly scriptBudget: Effect.Effect<typeof scriptBudgetSchema.Type>;
	readonly dispatch: (
		frame: SidecarHostCallFrameType,
	) => Effect.Effect<SidecarHostResultFrameType, GateError>;
	readonly inlineEntries: () => ReadonlyArray<WorkflowReplayJournalEntry>;
	readonly journal: SandboxInvocationJournal;
	readonly extend: (ms: number) => Effect.Effect<void, GateError>;
	readonly close: Effect.Effect<void>;
};

type EncodedJournalEntry = {
	readonly bytes: Uint8Array;
	readonly end: number;
	readonly start: number;
};

type JournalPrefix = {
	readonly entries: ReadonlyArray<EncodedJournalEntry>;
	readonly journal: SandboxInvocationJournal;
	readonly jsonBytes: number;
};

const gateError = (reason: string) => new GateError({ reason });

const encodeJournalPrefix = Effect.fnUntraced(function* (
	entries: ReadonlyArray<WorkflowReplayJournalEntry> | undefined,
): Effect.fn.Return<JournalPrefix, GateError> {
	const source = entries ?? [];
	if (source.length > SANDBOX_LIMITS.hostCalls.total) {
		return yield* gateError("Sandbox workflow journal length is invalid");
	}

	const encodedEntries: EncodedJournalEntry[] = [];
	const offsets = [0];
	let totalBytes = 0;
	let jsonBytes = 2;
	for (const [index, rawEntry] of source.entries()) {
		const entry = yield* decodeJournalPrefixEntry(rawEntry).pipe(
			Effect.mapError(() => gateError("Sandbox workflow journal prefix is invalid")),
		);
		if (entry.request.index !== index) {
			return yield* gateError("Sandbox workflow journal prefix is invalid");
		}
		const bytes = encodeJsonBytes(entry);
		const nextJsonBytes = jsonBytes + bytes.byteLength + (index === 0 ? 0 : 1);
		if (nextJsonBytes > SANDBOX_LIMITS.journalBytes) {
			return yield* gateError("Sandbox workflow journal exceeds its byte limit");
		}
		const start = totalBytes;
		totalBytes += bytes.byteLength;
		encodedEntries.push({ bytes, start, end: totalBytes });
		offsets.push(totalBytes);
		jsonBytes = nextJsonBytes;
	}

	return {
		jsonBytes,
		entries: encodedEntries,
		journal:
			entries === undefined ? undefined : { offsets, totalBytes, length: encodedEntries.length },
	};
});

const serializedJson = (value: unknown) => {
	if (!isJsonValue(value)) {
		return undefined;
	}
	try {
		return encodeUnknownJson(value);
	} catch {
		return undefined;
	}
};

const safeHostFailure = (error: unknown) => {
	if (error instanceof Schema.SchemaError || typeof error !== "object" || error === null) {
		return hostFailure(failureMessage);
	}
	const message = Reflect.get(error, "message");
	if (typeof message !== "string") {
		return hostFailure(failureMessage);
	}
	const data = Reflect.get(error, "data");
	return isJsonValue(data) ? hostFailure(message, data) : hostFailure(message);
};

const resultBytes = (frame: SidecarHostResultFrameType) => {
	const encoded = serializedJson(frame);
	return encoded === undefined ? Number.POSITIVE_INFINITY : utf8ByteLength(encoded);
};

const resultFrame = (
	frame: SidecarHostCallFrameType,
	result: SidecarHostResultFrameType["result"],
): SidecarHostResultFrameType => ({
	result,
	seq: frame.seq,
	type: "hostResult",
	handle: frame.handle,
	generation: frame.generation,
});

const hostResultFrame = (
	frame: SidecarHostCallFrameType,
	value: unknown,
): SidecarHostResultFrameType => {
	const serialized = serializedJson(value);
	if (
		serialized === undefined ||
		utf8ByteLength(serialized) > SANDBOX_LIMITS.bridge.responseBytes
	) {
		return resultFrame(frame, {
			status: "success",
			value: hostFailure(
				serialized === undefined
					? "Sandbox host result is not valid JSON"
					: `Sandbox bridge response exceeds ${SANDBOX_LIMITS.bridge.responseBytes} UTF-8 bytes`,
			),
		});
	}
	const jsonValue = decodeSidecarJson(value);
	if (Option.isNone(jsonValue)) {
		return resultFrame(frame, {
			status: "success",
			value: hostFailure("Sandbox host result is not valid JSON"),
		});
	}
	const result = resultFrame(frame, { status: "success", value: jsonValue.value });
	return resultBytes(result) <= SIDECAR_PROTOCOL_LIMITS.messageBytes.hostResult
		? result
		: resultFrame(frame, {
				status: "success",
				value: hostFailure("Sandbox host result exceeds the sidecar protocol limit"),
			});
};

const frameFailure = (
	frame: SidecarHostCallFrameType,
	message: string,
	data?: unknown,
): SidecarHostResultFrameType =>
	hostResultFrame(frame, isJsonValue(data) ? hostFailure(message, data) : hostFailure(message));

const ownerKey = (options: SandboxHostCallGateOptions) =>
	encodeUnknownJson([options.instance, options.generation, options.handle]);

const errorResponse = (frame: SidecarHostCallFrameType, error: unknown) =>
	hostResultFrame(frame, safeHostFailure(error));
const closeResult = (frame: SidecarHostCallFrameType) =>
	frameFailure(frame, "Sandbox execution is no longer active");

export class SandboxHostCallGate extends Context.Service<SandboxHostCallGate>()(
	"SandboxHostCallGate",
	{
		make: Effect.sync(() => {
			const registrations = new Map<string, Effect.Effect<void>>();

			const register = Effect.fn("SandboxHostCallGate.register")(function* (
				options: SandboxHostCallGateOptions,
			): Effect.fn.Return<SandboxHostCallGateRegistration, GateError, Scope.Scope> {
				const prefix = yield* encodeJournalPrefix(options.input.replayJournal);
				if (options.input.workflowExecutionId !== undefined && prefix.journal === undefined) {
					return yield* gateError("Workflow executions require a host-pinned journal prefix");
				}

				const closed = yield* Deferred.make<void>();
				const semaphore = yield* Semaphore.make(SANDBOX_LIMITS.bridge.concurrentHostCalls);
				const hostCallBudget = { http: 0, total: 0 };
				const seenSequences = new Set<number>();
				const inlineEncodedEntries: Uint8Array[] = [];
				const prefixEntries = [...prefix.entries];
				const hasJournalPrefix = prefix.journal !== undefined;
				const journalPrefixBytes = prefixEntries.at(-1)?.end ?? 0;
				let readCount = 0;
				let readBytes = 0;
				let totalJournalJsonBytes = prefix.jsonBytes;
				let pendingExtensionMs = 0;
				let settledMs = 0;
				let settlementStartedAt: number | undefined;
				const scriptStartedAt = yield* Clock.currentTimeMillis;
				let waiting = 0;
				let isClosed = false;
				let gateInput: SandboxRunInput | undefined = options.input;
				let gateFiles: SandboxFileAccess | undefined = options.files;
				let gateFunctions: Readonly<Record<string, BoundHostFunction>> | undefined =
					options.apiFunctions;
				const generation = options.generation;
				const handle = options.handle;
				const executionId = options.input.executionId;
				const parentSpan = options.parentSpan;
				const key = ownerKey(options);

				const clearBuffers = () => {
					for (const entry of prefixEntries) {
						entry.bytes.fill(0);
					}
					for (const bytes of inlineEncodedEntries) {
						bytes.fill(0);
					}
					prefixEntries.length = 0;
					inlineEncodedEntries.length = 0;
					seenSequences.clear();
					gateInput = undefined;
					gateFiles = undefined;
					gateFunctions = undefined;
					pendingExtensionMs = 0;
				};

				const close: Effect.Effect<void> = Effect.sync(() => {
					if (!isClosed) {
						isClosed = true;
						Deferred.doneUnsafe(closed, Effect.void);
						clearBuffers();
					}
					if (registrations.get(key) === close) {
						registrations.delete(key);
					}
				});

				const checkFrame = (frame: SidecarHostCallFrameType) =>
					Effect.gen(function* () {
						if (frame.handle !== handle || frame.generation !== generation) {
							return frameFailure(frame, "Sandbox host call identity does not match");
						}
						if (isClosed) {
							return closeResult(frame);
						}
						if ((yield* Clock.currentTimeMillis) > expiresAt) {
							yield* close;
							return frameFailure(frame, "Sandbox execution expired");
						}
						return undefined;
					});

				let expiresAt = (yield* Clock.currentTimeMillis) + initialExpiryMs;

				const sequenceFailure = (frame: SidecarHostCallFrameType) => {
					if (
						!Number.isSafeInteger(frame.seq) ||
						frame.seq < 0 ||
						seenSequences.has(frame.seq) ||
						seenSequences.size >= maximumSequenceCount
					) {
						return frameFailure(frame, "Sandbox host call sequence is invalid or repeated");
					}
					seenSequences.add(frame.seq);
					return undefined;
				};

				const withPermits = <A>(
					permits: number,
					effect: Effect.Effect<A>,
				): Effect.Effect<A | typeof dispatchQueueFull> =>
					Effect.suspend((): Effect.Effect<A | typeof dispatchQueueFull> => {
						if (waiting >= SANDBOX_LIMITS.bridge.concurrentHostCalls) {
							return Effect.succeed(dispatchQueueFull);
						}
						waiting += 1;
						let acquired = false;
						return semaphore
							.withPermits(permits)(
								Effect.gen(function* () {
									waiting -= 1;
									acquired = true;
									return yield* effect;
								}),
							)
							.pipe(
								Effect.ensuring(
									Effect.sync(() => {
										if (!acquired) {
											waiting -= 1;
										}
									}),
								),
							);
					});

				const raceClosed = (
					frame: SidecarHostCallFrameType,
					effect: Effect.Effect<SidecarHostResultFrameType, GateError>,
				) => Effect.raceFirst(effect, Deferred.await(closed).pipe(Effect.as(closeResult(frame))));

				const boundedHostCall = (
					frame: SidecarHostCallFrameType,
					name: string,
					effect: Effect.Effect<
						unknown,
						Schema.SchemaError | { readonly message: string; readonly data?: unknown }
					>,
				) =>
					effect.pipe(
						Effect.match({ onFailure: safeHostFailure, onSuccess: (value) => value }),
						Effect.onExit((exit) =>
							sandboxMetricHostFunction(name) === "unknown"
								? Effect.void
								: recordSandboxHostCall({
										function: name,
										outcome: exit._tag === "Success" ? "success" : "failure",
									}),
						),
						Effect.catchCauseIf(
							(cause) => !Cause.hasInterrupts(cause),
							() => Effect.succeed(hostFailure(failureMessage)),
						),
						Effect.map((value) => hostResultFrame(frame, value)),
						Effect.withSpan(`sandbox.host.${name}`, {
							attributes: { executionId, functionName: name },
						}),
						Effect.withParentSpan(parentSpan),
					);

				const journalRead = (frame: SidecarHostCallFrameType) =>
					Effect.sync(() => {
						if (readCount >= SANDBOX_LIMITS.journalReads.count) {
							return frameFailure(frame, "Sandbox workflow journal read budget exceeded");
						}
						readCount += 1;
						const decodedArgs = decodeJournalReadArgs(frame.args);
						if (Option.isNone(decodedArgs)) {
							return frameFailure(frame, "Sandbox workflow journal range is invalid");
						}
						const args = decodedArgs.value;
						const totalBytes = hasJournalPrefix ? journalPrefixBytes : undefined;
						if (
							totalBytes === undefined ||
							args.offset > Number.MAX_SAFE_INTEGER - args.length ||
							args.offset >= totalBytes
						) {
							return frameFailure(
								frame,
								"Sandbox workflow journal range is outside its pinned prefix",
							);
						}
						if (
							readBytes + Math.min(args.length, totalBytes - args.offset) >
							SANDBOX_LIMITS.journalReads.totalBytes
						) {
							return frameFailure(frame, "Sandbox workflow journal read budget exceeded");
						}
						const length = Math.min(args.length, totalBytes - args.offset);
						readBytes += length;
						const bytes = new Uint8Array(length);
						let written = 0;
						for (const entry of prefixEntries) {
							const start = Math.max(args.offset, entry.start);
							const end = Math.min(args.offset + length, entry.end);
							if (start >= end) {
								continue;
							}
							const sourceStart = start - entry.start;
							const count = end - start;
							bytes.set(entry.bytes.subarray(sourceStart, sourceStart + count), written);
							written += count;
						}
						if (written !== length) {
							bytes.fill(0);
							return frameFailure(frame, "Sandbox workflow journal range is incomplete");
						}
						const result = { totalBytes, offset: args.offset, data: Base64.encode(bytes) };
						bytes.fill(0);
						return hostResultFrame(frame, result);
					}).pipe(
						Effect.withSpan("sandbox.host.journalRead", { attributes: { executionId } }),
						Effect.withParentSpan(parentSpan),
					);

				const dispatchInlineBatch = (frame: SidecarHostCallFrameType) =>
					Effect.gen(function* () {
						const decoded = decodeInlineBatch(frame.args);
						if (Option.isNone(decoded)) {
							return frameFailure(frame, "Sandbox inline durable batch is invalid");
						}
						const requests = decoded.value.requests;
						const input = gateInput;
						const inline = input?.inlineDurableHost;
						if (!input || !inline) {
							return hostResultFrame(frame, { defer: true });
						}
						const inlineJson = serializedJson({ inline: decoded.value });
						if (
							inlineJson === undefined ||
							utf8ByteLength(`${inlineJson}\n`) > SANDBOX_LIMITS.bridge.requestBytes
						) {
							return hostResultFrame(frame, { defer: true });
						}
						const firstIndex = (input.replayJournal?.length ?? 0) + inlineEncodedEntries.length;
						const invalidRequest =
							requests.some(
								(request, index) =>
									request.index !== firstIndex + index ||
									!inline.capabilities.includes(request.args.capability) ||
									!isSandboxCapabilityAllowed(input, request.args.capability),
							) || firstIndex + requests.length > SANDBOX_LIMITS.hostCalls.total;
						if (invalidRequest) {
							return hostResultFrame(frame, { defer: true });
						}
						const requestBytes = requests.map((request) => encodeHostRequestJson(request));

						let budgetExceeded = false;
						for (const request of requests) {
							if (consumeSandboxHostCall(hostCallBudget, request.args.capability)) {
								budgetExceeded = true;
							}
						}
						if (budgetExceeded) {
							return hostResultFrame(frame, { defer: true });
						}

						const settledAtStart = yield* Clock.currentTimeMillis;
						settlementStartedAt = settledAtStart;
						const settled = yield* inline.settle(requests).pipe(
							Effect.timeoutOrElse({
								orElse: () => Effect.succeed(null),
								duration: SANDBOX_LIMITS.sidecar.settlementMs,
							}),
							Effect.match({ onFailure: () => null, onSuccess: (value) => value }),
							Effect.catchCauseIf(
								(cause) => !Cause.hasInterrupts(cause),
								() => Effect.succeed(null),
							),
							Effect.ensuring(
								Clock.currentTimeMillis.pipe(
									Effect.flatMap((endedAt) =>
										Effect.sync(() => {
											const elapsed = Math.max(0, endedAt - settledAtStart);
											settledMs += elapsed;
											pendingExtensionMs += elapsed;
											settlementStartedAt = undefined;
										}),
									),
								),
							),
						);
						if (settled === null || settled.length !== requests.length || isClosed) {
							return hostResultFrame(frame, { defer: true });
						}

						const canonicalResults = yield* Effect.forEach(settled, (result) =>
							Schema.decodeEffect(workflowDurableResultSchema, strictOptions)(result),
						).pipe(Effect.match({ onFailure: () => undefined, onSuccess: (results) => results }));
						if (canonicalResults === undefined) {
							return hostResultFrame(frame, { defer: true });
						}
						const inlineReply = { results: canonicalResults };
						const resultsJson = serializedJson(inlineReply);
						if (
							resultsJson === undefined ||
							utf8ByteLength(resultsJson) > SANDBOX_LIMITS.bridge.responseBytes
						) {
							return hostResultFrame(frame, { defer: true });
						}

						const replyValue = decodeSidecarJson(inlineReply);
						if (Option.isNone(replyValue)) {
							return hostResultFrame(frame, { defer: true });
						}
						const totalResult = resultFrame(frame, { status: "success", value: replyValue.value });
						if (resultBytes(totalResult) > SIDECAR_PROTOCOL_LIMITS.messageBytes.hostResult) {
							return hostResultFrame(frame, { defer: true });
						}

						const encodedEntries: Uint8Array[] = [];
						const deferAndClear = () => {
							for (const encoded of encodedEntries) {
								encoded.fill(0);
							}
							return hostResultFrame(frame, { defer: true });
						};
						let nextJournalJsonBytes = totalJournalJsonBytes;
						for (const [index, result] of canonicalResults.entries()) {
							const requestJson = requestBytes[index];
							if (requestJson === undefined) {
								return deferAndClear();
							}
							const journalEntry = decodeJournalEntry({
								value: result,
								request: decodeHostRequestJson(requestJson),
							});
							const bytes = encoder.encode(encodeJournalEntryJson(journalEntry));
							const separatorBytes =
								prefixEntries.length + inlineEncodedEntries.length + encodedEntries.length === 0
									? 0
									: 1;
							nextJournalJsonBytes += bytes.byteLength + separatorBytes;
							if (nextJournalJsonBytes > SANDBOX_LIMITS.journalBytes) {
								bytes.fill(0);
								return deferAndClear();
							}
							encodedEntries.push(bytes);
						}

						inlineEncodedEntries.push(...encodedEntries);
						totalJournalJsonBytes = nextJournalJsonBytes;
						return totalResult;
					}).pipe(
						Effect.catchCauseIf(
							(cause) => !Cause.hasInterrupts(cause),
							() => Effect.succeed(hostResultFrame(frame, { defer: true })),
						),
						Effect.withSpan("sandbox.host.inlineBatch", {
							attributes: { executionId, functionName: "inlineBatch" },
						}),
						Effect.withParentSpan(parentSpan),
					);

				const ordinaryDispatch = (frame: SidecarHostCallFrameType) =>
					Effect.gen(function* () {
						const decodedArgs = decodeHostCallArgs(frame.args);
						if (Option.isNone(decodedArgs)) {
							return frameFailure(frame, "Sandbox host call arguments are invalid");
						}
						const parsed = decodedArgs.value;
						const serializedArgs = serializedJson({ args: parsed });
						if (
							serializedArgs === undefined ||
							utf8ByteLength(serializedArgs) > SANDBOX_LIMITS.bridge.requestBytes
						) {
							return frameFailure(
								frame,
								`Sandbox bridge request exceeds ${SANDBOX_LIMITS.bridge.requestBytes} UTF-8 bytes`,
							);
						}

						const input = gateInput;
						const functions = gateFunctions;
						const fn =
							functions && Object.hasOwn(functions, frame.name) ? functions[frame.name] : undefined;
						if (
							!input ||
							!fn ||
							!isSandboxCapability(frame.name) ||
							!isSandboxCapabilityAllowed(input, frame.name)
						) {
							return frameFailure(frame, "Sandbox host function is not available");
						}
						return yield* boundedHostCall(frame, frame.name, fn(parsed));
					});

				const fileControl = (frame: SidecarHostCallFrameType) =>
					Effect.gen(function* () {
						const files = gateFiles;
						if (!files) {
							return frameFailure(frame, "Sandbox file session is unavailable");
						}
						if (frame.name === "artifactReadRange") {
							const args = decodeArtifactReadRangeArgs(frame.args);
							if (Option.isNone(args)) {
								return frameFailure(frame, "Sandbox artifact range arguments are invalid");
							}
							return yield* boundedHostCall(frame, frame.name, files.artifactReadRange(args.value));
						}
						const args = decodeScratchWriteArgs(frame.args);
						if (Option.isNone(args)) {
							return frameFailure(frame, "Sandbox scratch write arguments are invalid");
						}
						return yield* boundedHostCall(frame, frame.name, files.scratchWrite(args.value));
					});

				const dispatch: SandboxHostCallGateRegistration["dispatch"] = (frame) =>
					Effect.gen(function* () {
						const invalid = yield* checkFrame(frame);
						if (invalid) {
							return invalid;
						}
						const repeated = sequenceFailure(frame);
						if (repeated) {
							return repeated;
						}
						if (frame.name !== "journalRead" && frame.name !== "inlineBatch") {
							const budgetError = consumeSandboxHostCall(hostCallBudget, frame.name);
							if (budgetError) {
								return frameFailure(frame, budgetError.message, budgetError.reason);
							}
						}
						if (frame.name === "replayJournal") {
							return frameFailure(frame, "Sandbox host function is not available");
						}
						let action = ordinaryDispatch(frame);
						if (frame.name === "journalRead") {
							action = journalRead(frame);
						} else if (frame.name === "inlineBatch") {
							action = dispatchInlineBatch(frame);
						} else if (frame.name === "artifactReadRange" || frame.name === "scratchWrite") {
							action = fileControl(frame);
						}
						const permits =
							frame.name === "inlineBatch" ? SANDBOX_LIMITS.bridge.concurrentHostCalls : 1;
						return yield* raceClosed(
							frame,
							withPermits(
								permits,
								Effect.gen(function* () {
									const invalidAfterQueue = yield* checkFrame(frame);
									return invalidAfterQueue ?? (yield* action);
								}),
							).pipe(
								Effect.map((response) =>
									response === dispatchQueueFull
										? frameFailure(frame, "Sandbox host call queue is full")
										: response,
								),
							),
						);
					}).pipe(
						Effect.catchCauseIf(
							(cause) => !Cause.hasInterrupts(cause),
							(cause) => Effect.succeed(errorResponse(frame, cause)),
						),
					);

				const inlineEntries = () =>
					inlineEncodedEntries.map((bytes) => decodeJournalEntryJson(decoder.decode(bytes)));

				const extend: SandboxHostCallGateRegistration["extend"] = (ms) =>
					Effect.gen(function* () {
						if (isClosed || !Number.isFinite(ms) || ms < 0 || ms > pendingExtensionMs) {
							return yield* gateError(
								"Sandbox session extension is not validated inline settlement time",
							);
						}
						expiresAt += ms;
						pendingExtensionMs -= ms;
						return yield* Effect.void;
					});

				yield* Effect.acquireRelease(
					Effect.gen(function* () {
						const previous = registrations.get(key);
						if (previous) {
							yield* previous;
						}
						registrations.set(key, close);
					}),
					() => close,
				);
				const scriptBudget = Effect.map(Clock.currentTimeMillis, (now) => ({
					settledMs,
					remainingMs: isClosed
						? 0
						: Math.max(
								0,
								SANDBOX_LIMITS.execution.timeoutMs -
									(now -
										scriptStartedAt -
										settledMs -
										(settlementStartedAt === undefined
											? 0
											: Math.max(0, now - settlementStartedAt))),
							),
				}));
				return { close, extend, dispatch, scriptBudget, inlineEntries, journal: prefix.journal };
			});

			return { register };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
