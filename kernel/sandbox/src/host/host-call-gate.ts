import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { isSandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import { isJsonValue } from "@ryot-app/contract/schema/json";
import { hostFailure, jsonValueSchema } from "@ryot-app/plugin-backend-sdk/wire";
import {
	workflowDurableResultSchema,
	workflowInlineRequestSchema,
	workflowReplayJournalEntrySchema,
	type WorkflowInlineRequest,
	type WorkflowReplayJournalEntry,
} from "@ryot-app/plugin-backend-sdk/workflow";
import type { Scope, Tracer } from "effect";
import { Clock, Context, Data, Deferred, Effect, Layer, Option, Schema, Semaphore } from "effect";
import { Base64 } from "effect/encoding";

import { consumeSandboxHostCall, KiB, SANDBOX_LIMITS } from "../protocol/limits";
import {
	artifactReadRangeArgsSchema,
	base64DecodedLength,
	InlineBatchSchema,
	journalReadArgsSchema,
	scratchWriteArgsSchema,
	type SandboxInvocationSchema,
	type SidecarHostCallFrame,
	type SidecarHostResultFrame,
} from "../protocol/messages";
import { SandboxSidecarAdmission } from "./admission";
import { catchNonInterrupt } from "./catch-non-interrupt";
import type { SandboxFileAccess } from "./file-access";
import { sandboxHostResultBytes, sandboxHostResultWireBytes } from "./host-execution-policy";
import { SandboxInlineProgress } from "./inline-progress";
import type { BoundHostFunction, SandboxRunInput } from "./invocation";
import { encodedJsonBytes } from "./json-bytes";
import { recordSandboxHostCall, sandboxMetricHostFunction } from "./metrics";
import { SANDBOX_JOURNAL_CHUNK_BYTES } from "./pinned-journal";
import { makeSandboxShortWait } from "./short-wait";
import { SANDBOX_TRANSIENT_MEMORY, sandboxTransientPermitBytes } from "./transient-memory";

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
const progressJson = Schema.fromJsonString(SandboxInlineProgress);
const encodeProgressJson = Schema.encodeSync(progressJson, strictOptions);
const decodeProgressJson = Schema.decodeSync(progressJson, strictOptions);
const encodeHostRequestJson = Schema.encodeSync(
	Schema.fromJsonString(workflowInlineRequestSchema),
	strictOptions,
);
const decodeHostRequestJson = Schema.decodeSync(
	Schema.fromJsonString(workflowInlineRequestSchema),
	strictOptions,
);
const decodeJournalEntry = Schema.decodeUnknownSync(
	workflowReplayJournalEntrySchema,
	strictOptions,
);
const decodeJournalReadArgs = Schema.decodeUnknownOption(journalReadArgsSchema, strictOptions);
const decodeInlineBatch = Schema.decodeUnknownOption(InlineBatchSchema, strictOptions);
export const decodeHostCallArgs = Schema.decodeUnknownOption(
	Schema.Array(jsonValueSchema),
	strictOptions,
);
const decodeArtifactReadRangeArgs = Schema.decodeUnknownOption(
	artifactReadRangeArgsSchema,
	strictOptions,
);
const decodeScratchWriteArgs = Schema.decodeUnknownOption(scratchWriteArgsSchema, strictOptions);
const decodeArgsJson = Schema.decodeUnknownOption(
	Schema.fromJsonString(Schema.Json),
	strictOptions,
);
type TransientPermit = { readonly release: () => void; readonly shrink: (bytes: number) => void };

const makeTransientPool = (capacity: number) => {
	let used = 0;
	const waiters: Array<{ readonly bytes: number; readonly granted: Deferred.Deferred<void> }> = [];
	const grant = () => {
		for (let head = waiters[0]; head !== undefined && used + head.bytes <= capacity;) {
			waiters.shift();
			used += head.bytes;
			Deferred.doneUnsafe(head.granted, Effect.void);
			head = waiters[0];
		}
	};
	const permit = (bytes: number): TransientPermit => {
		let held = bytes;
		const shrink = (next: number) => {
			if (next < held) {
				used -= held - next;
				held = next;
				grant();
			}
		};
		return { shrink, release: () => shrink(0) };
	};
	const tryAcquire = (bytes: number) => {
		if (waiters.length > 0 || used + bytes > capacity) {
			return undefined;
		}
		used += bytes;
		return permit(bytes);
	};
	// Runs uninterruptibly except for the wait, so the caller owns the permit as soon as it returns.
	const acquire = (
		bytes: number,
		restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
	) =>
		Effect.gen(function* () {
			if (bytes > capacity) {
				return undefined;
			}
			const immediate = tryAcquire(bytes);
			if (immediate) {
				return immediate;
			}
			const waiter = { bytes, granted: yield* Deferred.make<void>() };
			waiters.push(waiter);
			yield* restore(Deferred.await(waiter.granted)).pipe(
				Effect.onInterrupt(() =>
					Effect.sync(() => {
						const index = waiters.indexOf(waiter);
						if (index === -1) {
							used -= bytes;
						} else {
							waiters.splice(index, 1);
						}
						grant();
					}),
				),
			);
			return permit(bytes);
		});
	return { acquire, tryAcquire, snapshot: () => ({ used, capacity, waiting: waiters.length }) };
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const failureMessage = "Sandbox host call failed";

export const decodeFrameArgs = (encoded: string) => {
	const bytes = Base64.decode(encoded);
	if (bytes._tag === "Failure") {
		return Option.none();
	}
	try {
		return decodeArgsJson(decoder.decode(bytes.success));
	} catch {
		return Option.none();
	}
};

type SidecarHostCallFrameType = typeof SidecarHostCallFrame.Type;
type SidecarHostResultFrameType = typeof SidecarHostResultFrame.Type;
type SandboxInvocationJournal = (typeof SandboxInvocationSchema.Type)["journal"];
const scriptBudgetSchema = Schema.Struct({ settledMs: Schema.Finite, remainingMs: Schema.Finite });

class GateError extends Data.TaggedError("SandboxHostCallGateError")<{ readonly reason: string }> {}

export type SandboxHostCallGateOptions = {
	readonly instance: string;
	readonly generation: number;
	readonly handle: string;
	readonly input: SandboxRunInput;
	readonly apiFunctions: Readonly<Record<string, BoundHostFunction>>;
	readonly files: SandboxFileAccess;
	readonly parentSpan: Tracer.AnySpan;
};

// Takes ownership of `released`, which must run once the reply is written or will never be.
export type SandboxHostResultDelivery = (
	reply: SidecarHostResultFrameType,
	released: () => void,
) => Effect.Effect<void>;

export type SandboxHostCallGateRegistration = {
	readonly scriptBudget: Effect.Effect<typeof scriptBudgetSchema.Type>;
	readonly dispatch: (
		frame: SidecarHostCallFrameType,
		deliver?: SandboxHostResultDelivery,
	) => Effect.Effect<SidecarHostResultFrameType, GateError>;
	readonly inlineEntries: () => ReadonlyArray<WorkflowReplayJournalEntry>;
	readonly pendingEntries: () => ReadonlyArray<SandboxInlineProgress>;
	readonly handoff: () => void;
	readonly journal: SandboxInvocationJournal;
	readonly extend: (ms: number) => Effect.Effect<void, GateError>;
	readonly close: Effect.Effect<void>;
};

const gateError = (reason: string) => new GateError({ reason });

const pinJournal = (
	source: NonNullable<SandboxRunInput["replayJournal"]>,
): SandboxInvocationJournal | undefined => {
	if (
		source.entries.length > SANDBOX_LIMITS.hostCalls.total ||
		source.bytes > SANDBOX_LIMITS.journalBytes
	) {
		return undefined;
	}
	const offsets = [0];
	let totalBytes = 0;
	for (const [bytes] of source.entries) {
		totalBytes += bytes;
		offsets.push(totalBytes);
	}
	return { offsets, totalBytes, length: source.entries.length };
};

const jsonBytesWithin = (value: unknown, limit: number) =>
	isJsonValue(value) && encodedJsonBytes(value, limit) <= limit;

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
	if (!isJsonValue(value)) {
		return resultFrame(frame, {
			status: "success",
			value: hostFailure("Sandbox host result is not valid JSON"),
		});
	}
	if (
		encodedJsonBytes(value, SANDBOX_LIMITS.bridge.responseBytes) >
		SANDBOX_LIMITS.bridge.responseBytes
	) {
		return resultFrame(frame, {
			status: "success",
			value: hostFailure(
				`Sandbox bridge response exceeds ${SANDBOX_LIMITS.bridge.responseBytes} UTF-8 bytes`,
			),
		});
	}
	return resultFrame(frame, { value, status: "success" });
};

const frameFailure = (
	frame: SidecarHostCallFrameType,
	message: string,
	data?: unknown,
): SidecarHostResultFrameType =>
	hostResultFrame(frame, isJsonValue(data) ? hostFailure(message, data) : hostFailure(message));

const ownerKey = (options: SandboxHostCallGateOptions) =>
	encodeUnknownJson([options.instance, options.generation, options.handle]);

type RunState = {
	readonly closed: Deferred.Deferred<void>;
	readonly drained: Deferred.Deferred<void>;
	readonly evidence: TransientPermit[];
	readonly hostCallBudget: { http: number; total: number };
	readonly inlineEncodedEntries: Uint8Array[];
	readonly journal: SandboxInvocationJournal | undefined;
	readonly journalSource: SandboxRunInput["replayJournal"];
	readonly pendingEncodedEntries: Map<number, Uint8Array>;
	readonly pinnedCount: number;
	readonly scriptStartedAt: number;
	readonly seenSequences: Set<number>;
	readonly semaphore: Semaphore.Semaphore;
	readonly shortWait: ReturnType<typeof makeSandboxShortWait>;
	expiresAt: number;
	gateFiles: SandboxFileAccess | undefined;
	gateFunctions: Readonly<Record<string, BoundHostFunction>> | undefined;
	gateInput: SandboxRunInput | undefined;
	handedOff: boolean;
	isClosed: boolean;
	outstanding: number;
	pendingExtensionMs: number;
	readBytes: number;
	readCount: number;
	settledMs: number;
	settlementStartedAt: number | undefined;
	totalJournalJsonBytes: number;
	waiting: number;
};

type GateAction = (
	state: RunState,
	options: SandboxHostCallGateOptions,
	frame: SidecarHostCallFrameType,
	frameArgs: unknown,
	retain: (bytes: number) => void,
) => Effect.Effect<SidecarHostResultFrameType, GateError>;

const closeResult = (frame: SidecarHostCallFrameType) =>
	frameFailure(frame, "Sandbox execution is no longer active");

const releaseOnReturn: SandboxHostResultDelivery = (_reply, released) => Effect.sync(released);

const makeRunState = Effect.fnUntraced(function* (
	options: SandboxHostCallGateOptions,
	journal: SandboxInvocationJournal | undefined,
) {
	const journalSource = options.input.replayJournal;
	const closed = yield* Deferred.make<void>();
	const semaphore = yield* Semaphore.make(SANDBOX_LIMITS.bridge.concurrentHostCalls);
	const scriptStartedAt = yield* Clock.currentTimeMillis;
	const drained = yield* Deferred.make<void>();
	const state: RunState = {
		closed,
		drained,
		journal,
		semaphore,
		waiting: 0,
		readBytes: 0,
		readCount: 0,
		settledMs: 0,
		evidence: [],
		journalSource,
		outstanding: 0,
		scriptStartedAt,
		isClosed: false,
		handedOff: false,
		pendingExtensionMs: 0,
		seenSequences: new Set(),
		inlineEncodedEntries: [],
		gateInput: options.input,
		gateFiles: options.files,
		settlementStartedAt: undefined,
		pendingEncodedEntries: new Map(),
		shortWait: makeSandboxShortWait(),
		gateFunctions: options.apiFunctions,
		hostCallBudget: { http: 0, total: 0 },
		pinnedCount: journalSource?.entries.length ?? 0,
		totalJournalJsonBytes: journalSource?.bytes ?? 2,
		expiresAt: (yield* Clock.currentTimeMillis) + initialExpiryMs,
	};
	return state;
});

const clearBuffers = (state: RunState) => {
	for (const bytes of state.inlineEncodedEntries) {
		bytes.fill(0);
	}
	state.inlineEncodedEntries.length = 0;
	for (const bytes of state.pendingEncodedEntries.values()) {
		bytes.fill(0);
	}
	state.pendingEncodedEntries.clear();
	state.seenSequences.clear();
	state.gateInput = undefined;
	state.gateFiles = undefined;
	state.gateFunctions = undefined;
	state.pendingExtensionMs = 0;
};

const sequenceFailure = (state: RunState, frame: SidecarHostCallFrameType) => {
	if (
		!Number.isSafeInteger(frame.seq) ||
		frame.seq < 0 ||
		state.seenSequences.has(frame.seq) ||
		state.seenSequences.size >= maximumSequenceCount
	) {
		return frameFailure(frame, "Sandbox host call sequence is invalid or repeated");
	}
	state.seenSequences.add(frame.seq);
	return undefined;
};

const withPermits = <A, E>(
	state: RunState,
	permits: number,
	effect: Effect.Effect<A, E>,
): Effect.Effect<A | typeof dispatchQueueFull, E> =>
	Effect.suspend((): Effect.Effect<A | typeof dispatchQueueFull, E> => {
		if (state.waiting >= SANDBOX_LIMITS.bridge.concurrentHostCalls) {
			return Effect.succeed(dispatchQueueFull);
		}
		state.waiting += 1;
		let acquired = false;
		return state.semaphore
			.withPermits(permits)(
				Effect.gen(function* () {
					state.waiting -= 1;
					acquired = true;
					return yield* effect;
				}),
			)
			.pipe(
				Effect.ensuring(
					Effect.sync(() => {
						if (!acquired) {
							state.waiting -= 1;
						}
					}),
				),
			);
	});

const raceClosed = (
	state: RunState,
	frame: SidecarHostCallFrameType,
	effect: Effect.Effect<SidecarHostResultFrameType, GateError>,
) => Effect.raceFirst(effect, Deferred.await(state.closed).pipe(Effect.as(closeResult(frame))));

const boundedHostCall = (
	options: SandboxHostCallGateOptions,
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
		catchNonInterrupt(() => Effect.succeed(hostFailure(failureMessage))),
		Effect.map((value) => hostResultFrame(frame, value)),
		Effect.withSpan(`sandbox.host.${name}`, {
			attributes: { functionName: name, executionId: options.input.executionId },
		}),
		Effect.withParentSpan(options.parentSpan),
	);

const inlineProgressBoundBytes = (requests: ReadonlyArray<WorkflowInlineRequest>) => {
	let valueBytes = 0;
	let progressBoundBytes = 0;
	for (const request of requests) {
		const resultBytes =
			request.kind === "sleep" ? 4 : sandboxHostResultBytes(request.args.capability);
		if (resultBytes === null) {
			return undefined;
		}
		valueBytes += resultBytes;
		const wireBytes =
			request.kind === "sleep" ? 4 : sandboxHostResultWireBytes(request.args.capability);
		if (wireBytes === null) {
			return undefined;
		}
		progressBoundBytes +=
			Math.min(wireBytes, SANDBOX_LIMITS.bridge.responseBytes) +
			2 * encoder.encode(encodeHostRequestJson(request)).byteLength +
			8 * KiB;
	}
	return { valueBytes, progressBoundBytes };
};

const journalRead: GateAction = (state, options, frame, frameArgs) =>
	Effect.gen(function* () {
		if (state.readCount >= SANDBOX_LIMITS.journalReads.count) {
			return frameFailure(frame, "Sandbox workflow journal read budget exceeded");
		}
		state.readCount += 1;
		const decodedArgs = decodeJournalReadArgs(frameArgs);
		if (Option.isNone(decodedArgs)) {
			return frameFailure(frame, "Sandbox workflow journal range is invalid");
		}
		const args = decodedArgs.value;
		const { journal, journalSource } = state;
		const index = journal?.offsets.findLastIndex((start) => start <= args.offset) ?? -1;
		const start = journal?.offsets[index];
		const pin = journalSource?.entries[index];
		if (
			journal === undefined ||
			journalSource === undefined ||
			start === undefined ||
			pin === undefined ||
			args.offset >= journal.totalBytes
		) {
			return frameFailure(frame, "Sandbox workflow journal range is outside its pinned prefix");
		}
		const chunk = Math.floor((args.offset - start) / SANDBOX_JOURNAL_CHUNK_BYTES);
		const chunkStart = chunk * SANDBOX_JOURNAL_CHUNK_BYTES;
		const chunkBytes = Math.min(SANDBOX_JOURNAL_CHUNK_BYTES, pin[0] - chunkStart);
		if (state.readBytes + chunkBytes > SANDBOX_LIMITS.journalReads.totalBytes) {
			return frameFailure(frame, "Sandbox workflow journal read budget exceeded");
		}
		state.readBytes += chunkBytes;
		const bytes = yield* journalSource.readChunk(index, chunk);
		if (bytes === null) {
			return frameFailure(frame, "Sandbox workflow journal projection is unavailable");
		}
		if (bytes.byteLength !== chunkBytes) {
			bytes.fill(0);
			return frameFailure(frame, "Sandbox workflow journal range is incomplete");
		}
		const from = args.offset - start - chunkStart;
		const data = Base64.encode(bytes.subarray(from, from + args.length));
		bytes.fill(0);
		return hostResultFrame(frame, { data, offset: args.offset, totalBytes: journal.totalBytes });
	}).pipe(
		Effect.withSpan("sandbox.host.journalRead", {
			attributes: { executionId: options.input.executionId },
		}),
		Effect.withParentSpan(options.parentSpan),
	);

const dispatchInlineBatch: GateAction = (state, options, frame, frameArgs, retain) =>
	Effect.gen(function* () {
		const decoded = decodeInlineBatch(frameArgs);
		if (Option.isNone(decoded)) {
			return frameFailure(frame, "Sandbox inline durable batch is invalid");
		}
		const requests = decoded.value.requests;
		const input = state.gateInput;
		const inline = input?.inlineDurableHost;
		if (!input || !inline) {
			return hostResultFrame(frame, { defer: true });
		}
		if (!jsonBytesWithin({ inline: decoded.value }, SANDBOX_LIMITS.bridge.requestBytes - 1)) {
			return hostResultFrame(frame, { defer: true });
		}
		const firstIndex = state.pinnedCount + state.inlineEncodedEntries.length;
		const invalidRequest =
			requests.some(
				(request, index) =>
					request.index !== firstIndex + index ||
					(request.kind === "host" &&
						(!inline.capabilities.includes(request.args.capability) ||
							!input.principal.metadata.capabilities?.includes(request.args.capability))),
			) || firstIndex + requests.length > SANDBOX_LIMITS.hostCalls.total;
		if (invalidRequest) {
			return hostResultFrame(frame, { defer: true });
		}
		const requestBytes = requests.map((request) => encodeHostRequestJson(request));

		let budgetExceeded = false;
		for (const request of requests) {
			if (
				consumeSandboxHostCall(
					state.hostCallBudget,
					request.kind === "host" ? request.args.capability : "sleep",
				)
			) {
				budgetExceeded = true;
			}
		}
		if (budgetExceeded) {
			return hostResultFrame(frame, { defer: true });
		}
		const bounds = inlineProgressBoundBytes(requests);
		if (bounds === undefined) {
			return hostResultFrame(frame, { defer: true });
		}
		const { valueBytes, progressBoundBytes } = bounds;
		if (
			valueBytes > SANDBOX_TRANSIENT_MEMORY.inlineValueBytes ||
			progressBoundBytes * SANDBOX_TRANSIENT_MEMORY.evidenceCopies >
				SANDBOX_TRANSIENT_MEMORY.inlineEvidenceBytes
		) {
			return hostResultFrame(frame, { defer: true });
		}
		const checkpoint = (progress: SandboxInlineProgress) =>
			Effect.sync(() => {
				const index = progress.request.index - firstIndex;
				if (
					state.isClosed ||
					requestBytes[index] !== encodeHostRequestJson(progress.request) ||
					(progress._tag === "Http" && progress.request.args.capability !== "httpCall")
				) {
					throw gateError("Sandbox inline progress does not match its batch");
				}
				const bytes = encoder.encode(encodeProgressJson(progress));
				state.pendingEncodedEntries.get(progress.request.index)?.fill(0);
				state.pendingEncodedEntries.set(progress.request.index, bytes);
				const held = [...state.pendingEncodedEntries.values()].reduce(
					(sum, entry) => sum + entry.byteLength,
					0,
				);
				if (held > progressBoundBytes) {
					throw gateError("Sandbox inline progress exceeds its reserved evidence");
				}
				retain(SANDBOX_TRANSIENT_MEMORY.evidenceCopies * held);
			});

		const settledAtStart = yield* Clock.currentTimeMillis;
		state.settlementStartedAt = settledAtStart;
		const settled = yield* inline.settle(requests, state.shortWait, checkpoint).pipe(
			Effect.timeoutOrElse({
				orElse: () => Effect.succeed(null),
				duration: SANDBOX_LIMITS.sidecar.settlementMs,
			}),
			Effect.match({ onFailure: () => null, onSuccess: (value) => value }),
			catchNonInterrupt(() => Effect.succeed(null)),
			Effect.ensuring(
				Clock.currentTimeMillis.pipe(
					Effect.flatMap((endedAt) =>
						Effect.sync(() => {
							const elapsed = Math.max(0, endedAt - settledAtStart);
							state.settledMs += elapsed;
							state.pendingExtensionMs += elapsed;
							state.settlementStartedAt = undefined;
						}),
					),
				),
			),
		);
		if (settled === null || settled.length !== requests.length || state.isClosed) {
			return hostResultFrame(frame, { defer: true });
		}

		const canonicalResults = yield* Effect.forEach(settled, (result, index) =>
			requests[index]?.kind === "sleep"
				? Schema.decodeUnknownEffect(Schema.Null)(result)
				: Schema.decodeUnknownEffect(workflowDurableResultSchema, strictOptions)(result),
		).pipe(Effect.match({ onFailure: () => undefined, onSuccess: (results) => results }));
		if (canonicalResults === undefined) {
			return hostResultFrame(frame, { defer: true });
		}
		const inlineReply = { results: canonicalResults };
		if (
			!isJsonValue(inlineReply) ||
			!jsonBytesWithin(inlineReply, SANDBOX_LIMITS.bridge.responseBytes)
		) {
			return hostResultFrame(frame, { defer: true });
		}
		const totalResult = resultFrame(frame, { status: "success", value: inlineReply });

		const encodedEntries: Uint8Array[] = [];
		const deferAndClear = () => {
			for (const encoded of encodedEntries) {
				encoded.fill(0);
			}
			return hostResultFrame(frame, { defer: true });
		};
		let nextJournalJsonBytes = state.totalJournalJsonBytes;
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
				state.pinnedCount + state.inlineEncodedEntries.length + encodedEntries.length === 0 ? 0 : 1;
			nextJournalJsonBytes += bytes.byteLength + separatorBytes;
			if (nextJournalJsonBytes > SANDBOX_LIMITS.journalBytes) {
				bytes.fill(0);
				return deferAndClear();
			}
			encodedEntries.push(bytes);
		}

		state.inlineEncodedEntries.push(...encodedEntries);
		for (const request of requests) {
			state.pendingEncodedEntries.get(request.index)?.fill(0);
			state.pendingEncodedEntries.delete(request.index);
		}
		state.totalJournalJsonBytes = nextJournalJsonBytes;
		retain(
			SANDBOX_TRANSIENT_MEMORY.evidenceCopies *
				encodedEntries.reduce((sum, bytes) => sum + bytes.byteLength, 0),
		);
		return totalResult;
	}).pipe(
		catchNonInterrupt(() => Effect.succeed(hostResultFrame(frame, { defer: true }))),
		Effect.withSpan("sandbox.host.inlineBatch", {
			attributes: { functionName: "inlineBatch", executionId: options.input.executionId },
		}),
		Effect.withParentSpan(options.parentSpan),
	);

const ordinaryDispatch: GateAction = (state, options, frame, frameArgs) =>
	Effect.gen(function* () {
		const decodedArgs = decodeHostCallArgs(frameArgs);
		if (Option.isNone(decodedArgs)) {
			return frameFailure(frame, "Sandbox host call arguments are invalid");
		}
		const parsed = decodedArgs.value;
		if (!jsonBytesWithin({ args: parsed }, SANDBOX_LIMITS.bridge.requestBytes)) {
			return frameFailure(
				frame,
				`Sandbox bridge request exceeds ${SANDBOX_LIMITS.bridge.requestBytes} UTF-8 bytes`,
			);
		}

		const input = state.gateInput;
		const functions = state.gateFunctions;
		const fn =
			functions && Object.hasOwn(functions, frame.name) ? functions[frame.name] : undefined;
		if (
			!input ||
			!fn ||
			!isSandboxHostCapability(frame.name) ||
			!input.principal.metadata.capabilities?.includes(frame.name)
		) {
			return frameFailure(frame, "Sandbox host function is not available");
		}
		return yield* boundedHostCall(options, frame, frame.name, fn(parsed));
	});

const fileControl: GateAction = (state, options, frame, frameArgs) =>
	Effect.gen(function* () {
		const files = state.gateFiles;
		if (!files) {
			return frameFailure(frame, "Sandbox file session is unavailable");
		}
		if (frame.name === "artifactReadRange") {
			const args = decodeArtifactReadRangeArgs(frameArgs);
			if (Option.isNone(args)) {
				return frameFailure(frame, "Sandbox artifact range arguments are invalid");
			}
			return yield* boundedHostCall(
				options,
				frame,
				frame.name,
				files.artifactReadRange(args.value),
			);
		}
		const args = decodeScratchWriteArgs(frameArgs);
		if (Option.isNone(args)) {
			return frameFailure(frame, "Sandbox scratch write arguments are invalid");
		}
		return yield* boundedHostCall(options, frame, frame.name, files.scratchWrite(args.value));
	});

export class SandboxHostCallGate extends Context.Service<SandboxHostCallGate>()(
	"SandboxHostCallGate",
	{
		make: Effect.gen(function* () {
			const { plan } = yield* SandboxSidecarAdmission;
			const registrations = new Map<string, Effect.Effect<void>>();
			const interactive = makeTransientPool(plan.pools.interactive);
			const pools = {
				interactive,
				background: plan.mode === "lane" ? makeTransientPool(plan.pools.background) : interactive,
			};

			const register = Effect.fn("SandboxHostCallGate.register")(function* (
				options: SandboxHostCallGateOptions,
			): Effect.fn.Return<SandboxHostCallGateRegistration, GateError, Scope.Scope> {
				const pool = pools[options.input.lane];
				const journalSource = options.input.replayJournal;
				const journal = journalSource === undefined ? undefined : pinJournal(journalSource);
				if (journalSource !== undefined && journal === undefined) {
					return yield* gateError("Sandbox workflow journal exceeds its byte limit");
				}
				if (options.input.workflowExecutionId !== undefined && journal === undefined) {
					return yield* gateError("Workflow executions require a host-pinned journal prefix");
				}

				const state = yield* makeRunState(options, journal);
				const generation = options.generation;
				const handle = options.handle;
				const key = ownerKey(options);

				const pendingEntries = () =>
					[...state.pendingEncodedEntries.values()].map((bytes) =>
						decodeProgressJson(decoder.decode(bytes)),
					);
				const close: Effect.Effect<void> = Effect.gen(function* () {
					if (!state.isClosed) {
						state.isClosed = true;
						Deferred.doneUnsafe(state.closed, Effect.void);
						const cancel = state.gateInput?.inlineDurableHost?.cancel;
						if (!state.handedOff && cancel) {
							yield* cancel(pendingEntries());
						}
						clearBuffers(state);
						if (state.outstanding === 0) {
							Deferred.doneUnsafe(state.drained, Effect.void);
						}
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
						if (state.isClosed) {
							return closeResult(frame);
						}
						if ((yield* Clock.currentTimeMillis) > state.expiresAt) {
							yield* close;
							return frameFailure(frame, "Sandbox execution expired");
						}
						return undefined;
					});

				const track = (permit: TransientPermit) => {
					state.outstanding += 1;
					let held = true;
					return (retainedBytes = 0) => {
						if (!held) {
							return;
						}
						held = false;
						if (retainedBytes > 0 && !state.isClosed) {
							permit.shrink(retainedBytes);
							state.evidence.push(permit);
						} else {
							permit.release();
						}
						state.outstanding -= 1;
						if (state.outstanding === 0 && state.isClosed) {
							Deferred.doneUnsafe(state.drained, Effect.void);
						}
					};
				};

				const dispatch: SandboxHostCallGateRegistration["dispatch"] = (
					frame,
					deliver = releaseOnReturn,
				) =>
					Effect.gen(function* () {
						const invalid = yield* checkFrame(frame);
						if (invalid) {
							return invalid;
						}
						const repeated = sequenceFailure(state, frame);
						if (repeated) {
							return repeated;
						}
						if (frame.name !== "journalRead" && frame.name !== "inlineBatch") {
							const budgetError = consumeSandboxHostCall(state.hostCallBudget, frame.name);
							if (budgetError) {
								return frameFailure(frame, budgetError.message, budgetError.reason);
							}
						}
						const argsBytes = base64DecodedLength(frame.args);
						if (argsBytes > SANDBOX_LIMITS.bridge.requestBytes) {
							return frameFailure(
								frame,
								`Sandbox bridge request exceeds ${SANDBOX_LIMITS.bridge.requestBytes} UTF-8 bytes`,
							);
						}
						let action: GateAction = ordinaryDispatch;
						if (frame.name === "journalRead") {
							action = journalRead;
						} else if (frame.name === "inlineBatch") {
							action = dispatchInlineBatch;
						} else if (frame.name === "artifactReadRange" || frame.name === "scratchWrite") {
							action = fileControl;
						}
						const bytes = sandboxTransientPermitBytes(frame.name, argsBytes);
						const permits =
							frame.name === "inlineBatch" ? SANDBOX_LIMITS.bridge.concurrentHostCalls : 1;
						const response = yield* withPermits(
							state,
							permits,
							Effect.uninterruptibleMask((restore) =>
								Effect.gen(function* () {
									const permit =
										frame.name === "inlineBatch"
											? pool.tryAcquire(bytes)
											: yield* pool.acquire(bytes, restore);
									if (permit === undefined) {
										const reply =
											frame.name === "inlineBatch"
												? hostResultFrame(frame, { defer: true })
												: frameFailure(
														frame,
														"Sandbox host call exceeds its lane's transient memory",
													);
										yield* deliver(reply, () => undefined);
										return reply;
									}
									const release = track(permit);
									let retainedBytes = 0;
									// The permit outlives a closed race until the host work and the reply write both end.
									let obligations = 2;
									const settle = () => {
										obligations -= 1;
										if (obligations === 0) {
											release(retainedBytes);
										}
									};
									let workState: "pending" | "running" | "settled" = "pending";
									const settleWork = () => {
										if (workState !== "settled") {
											workState = "settled";
											settle();
										}
									};
									const body = Effect.gen(function* () {
										const invalidAfterQueue = yield* checkFrame(frame);
										if (invalidAfterQueue) {
											return invalidAfterQueue;
										}
										const args = decodeFrameArgs(frame.args);
										if (Option.isNone(args)) {
											return frameFailure(frame, "Sandbox host call arguments are invalid");
										}
										return yield* action(state, options, frame, args.value, (retained) => {
											retainedBytes = retained;
										});
									});
									const work = Effect.suspend(() => {
										if (workState === "settled") {
											return Effect.succeed(closeResult(frame));
										}
										workState = "running";
										return body;
									}).pipe(Effect.ensuring(Effect.sync(settleWork)));
									const reply = yield* restore(raceClosed(state, frame, work)).pipe(
										Effect.onExit(() =>
											Effect.sync(() => {
												if (workState === "pending") {
													settleWork();
												}
											}),
										),
										Effect.onError(() => Effect.sync(settle)),
									);
									yield* deliver(reply, settle);
									return reply;
								}),
							),
						);
						return response === dispatchQueueFull
							? frameFailure(frame, "Sandbox host call queue is full")
							: response;
					}).pipe(
						catchNonInterrupt((cause) =>
							Effect.succeed(hostResultFrame(frame, safeHostFailure(cause))),
						),
					);

				const inlineEntries = () =>
					state.inlineEncodedEntries.map((bytes) => decodeJournalEntryJson(decoder.decode(bytes)));

				const extend: SandboxHostCallGateRegistration["extend"] = (ms) =>
					Effect.gen(function* () {
						if (state.isClosed || !Number.isFinite(ms) || ms < 0 || ms > state.pendingExtensionMs) {
							return yield* gateError(
								"Sandbox session extension is not validated inline settlement time",
							);
						}
						state.expiresAt += ms;
						state.pendingExtensionMs -= ms;
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
					() =>
						close.pipe(
							Effect.andThen(Deferred.await(state.drained)),
							Effect.andThen(
								Effect.sync(() => {
									for (const permit of state.evidence.splice(0)) {
										permit.release();
									}
								}),
							),
						),
				);
				const scriptBudget = Effect.map(Clock.currentTimeMillis, (now) => ({
					settledMs: state.settledMs,
					remainingMs: state.isClosed
						? 0
						: Math.max(
								0,
								SANDBOX_LIMITS.execution.timeoutMs -
									(now -
										state.scriptStartedAt -
										state.settledMs -
										(state.settlementStartedAt === undefined
											? 0
											: Math.max(0, now - state.settlementStartedAt))),
							),
				}));
				return {
					close,
					extend,
					journal,
					dispatch,
					scriptBudget,
					inlineEntries,
					pendingEntries,
					handoff: () => {
						state.handedOff = true;
					},
				};
			});

			return { register, transientMemory: (lane: ExecutionLane) => pools[lane].snapshot() };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
