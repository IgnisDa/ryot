import {
	SandboxExecutionError,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/sandbox/schemas";
import { jsonValueSchema } from "@ryot-app/contract/modules/sandbox/wire";
import { workflowHostRequestSchema } from "@ryot-app/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";

import { KiB, MiB, SANDBOX_LIMITS } from "./limits";

const maxContextBytes = SANDBOX_LIMITS.execution.contextBytes;

const numberIsSafeInteger = Number.isSafeInteger.bind(Number);
const jsonStringify = JSON.stringify.bind(JSON);
const encoder = new TextEncoder();
const encodeText = encoder.encode.bind(encoder);
const stringEndsWithMethod = Object.getOwnPropertyDescriptor(String.prototype, "endsWith")?.value;
const regexpExecMethod = Object.getOwnPropertyDescriptor(RegExp.prototype, "exec")?.value;
const boundStringEndsWith = stringEndsWithMethod.call.bind(stringEndsWithMethod);
const boundRegExpExec = regexpExecMethod.call.bind(regexpExecMethod);
const stringEndsWith = (value: string, part: string) => {
	const result: unknown = boundStringEndsWith(value, part);
	return typeof result === "boolean" && result;
};
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const isBase64 = (value: string) =>
	value.length % 4 === 0 && boundRegExpExec(base64Pattern, value) !== null;

export const base64DecodedLength = (value: string) => {
	let padding = 0;
	if (stringEndsWith(value, "==")) {
		padding = 2;
	} else if (stringEndsWith(value, "=")) {
		padding = 1;
	}
	return (value.length / 4) * 3 - padding;
};

const safeNonNegativeInteger = Schema.Finite.pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				(numberIsSafeInteger(value) && value >= 0) || "Expected a safe nonnegative integer",
		),
	),
);
const rangeLength = Schema.Finite.pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				(numberIsSafeInteger(value) && value >= 1 && value <= MiB) ||
				"Expected a range length from 1 through 1048576",
		),
	),
);

const journalSchema = Schema.Struct({
	offsets: Schema.Array(safeNonNegativeInteger).pipe(
		Schema.check(Schema.isMaxLength(SANDBOX_LIMITS.hostCalls.total + 1)),
	),
	length: Schema.Finite.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
		Schema.check(Schema.isLessThanOrEqualTo(SANDBOX_LIMITS.hostCalls.total)),
	),
	totalBytes: Schema.Finite.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
		Schema.check(Schema.isLessThanOrEqualTo(SANDBOX_LIMITS.journalBytes)),
	),
}).pipe(
	Schema.check(
		Schema.makeFilter(({ length, offsets, totalBytes }) => {
			if (
				offsets.length !== length + 1 ||
				offsets[0] !== 0 ||
				offsets[offsets.length - 1] !== totalBytes
			) {
				return "Journal offsets must cover the pinned prefix";
			}
			for (let index = 0; index < offsets.length; index += 1) {
				const offset = offsets[index];
				const previous = offsets[index - 1];
				if (
					offset === undefined ||
					offset > totalBytes ||
					(previous !== undefined && offset < previous)
				) {
					return "Journal offsets must be monotonic safe byte boundaries";
				}
			}
			return true;
		}),
	),
);

const filesystemHintsSchema = Schema.Struct({
	scratch: Schema.Boolean,
	artifact: Schema.Boolean,
	namedArtifacts: Schema.Array(Schema.String),
});

export const SandboxInvocationSchema = Schema.Struct({
	scriptId: Schema.String,
	startedAt: Schema.String,
	executionId: Schema.String,
	metadata: SandboxScriptMetadata,
	compiledFormat: Schema.Literal(1),
	mode: Schema.Literal("definition"),
	journal: Schema.optional(journalSchema),
	apiFunctions: Schema.Array(Schema.String),
	filesystem: Schema.optional(filesystemHintsSchema),
	workflowExecutionId: Schema.optional(Schema.String),
	inlineDurableCapabilities: Schema.optional(Schema.Array(Schema.String)),
	context: jsonValueSchema.pipe(
		Schema.check(
			Schema.makeFilter((value) => {
				const serialized = jsonStringify(value);
				return (
					(typeof serialized === "string" &&
						encodeText(serialized).byteLength <= maxContextBytes) ||
					`Sandbox invocation context exceeds ${maxContextBytes} UTF-8 bytes`
				);
			}),
		),
	),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(invocation) =>
				invocation.workflowExecutionId === undefined ||
				invocation.journal !== undefined ||
				"Workflow executions require a host-pinned journal prefix",
		),
	),
);
export type SandboxInvocation = Schema.Schema.Type<typeof SandboxInvocationSchema>;

export const journalReadArgsSchema = Schema.Struct({
	length: rangeLength,
	offset: safeNonNegativeInteger,
});

const base64RangeData = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				(value.length <= 1_398_104 && isBase64(value)) || "Expected at most 1 MiB of base64 data",
		),
	),
);

export const journalReadResultSchema = Schema.Struct({
	data: base64RangeData,
	offset: safeNonNegativeInteger,
	totalBytes: safeNonNegativeInteger,
});

export const artifactReadRangeArgsSchema = Schema.Struct({
	length: rangeLength,
	offset: safeNonNegativeInteger,
	key: Schema.optional(Schema.String),
});

export const artifactReadRangeResultSchema = Schema.Struct({
	data: base64RangeData,
	size: safeNonNegativeInteger,
	offset: safeNonNegativeInteger,
});

const scratchData = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				(isBase64(value) && base64DecodedLength(value) <= SANDBOX_LIMITS.scratch.chunkBytes) ||
				"Scratch data exceeds 256 KiB or is not base64",
		),
	),
);
export const scratchWriteArgsSchema = Schema.Struct({
	data: scratchData,
	name: Schema.String,
	final: Schema.Boolean,
	offset: safeNonNegativeInteger,
});

export const InlineBatchSchema = Schema.Struct({
	requests: Schema.NonEmptyArray(workflowHostRequestSchema),
});

export const InlineBatchReplySchema = Schema.Union([
	Schema.Struct({ defer: Schema.Literal(true) }),
	Schema.Struct({ results: Schema.Array(jsonValueSchema) }),
]);

export const SandboxInvocationResponseSchema = Schema.Union([
	Schema.Struct({
		value: jsonValueSchema,
		success: Schema.Literal(true),
		logs: Schema.Array(Schema.String),
		timing: Schema.Struct({ executionMs: Schema.Finite }),
	}),
	Schema.Struct({
		error: SandboxExecutionError,
		success: Schema.Literal(false),
		logs: Schema.Array(Schema.String),
		timing: Schema.Struct({ executionMs: Schema.Finite }),
	}),
]);
export type SandboxInvocationResponse = Schema.Schema.Type<typeof SandboxInvocationResponseSchema>;

export const SIDECAR_PROTOCOL_LIMITS = {
	nameLength: 128,
	partBytes: 64 * KiB,
	consoleEntries: 500,
	frameBytes: 256 * KiB,
	messageBytes: { run: 4 * MiB, done: 6 * MiB, hostCall: 2 * MiB, hostResult: 12 * MiB },
	execution: {
		cpuMs: { minimum: 1, maximum: 600_000 },
		deadlineMs: { minimum: 1, maximum: 600_000 },
		heapBytes: { minimum: 8 * MiB, maximum: 1024 * MiB },
		externalBytes: { minimum: MiB, maximum: 1024 * MiB },
	},
} as const;

const boundedInt = (range: { readonly minimum: number; readonly maximum: number }) =>
	Schema.Int.check(Schema.isBetween(range));

const Handle = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/));
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const Base64 = Schema.String.check(Schema.isPattern(base64Pattern));
const Seq = boundedInt({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const Generation = boundedInt({ minimum: 0, maximum: 4_294_967_295 });

const envelope = { seq: Seq, handle: Handle, generation: Generation };

export const SidecarTier = Schema.Literals(["core", "data", "full"]);
export const SIDECAR_INTERNAL_HOST_CALLS = [
	"artifactReadRange",
	"inlineBatch",
	"journalRead",
	"replayJournal",
	"scratchWrite",
] as const;
export const SidecarLane = Schema.Literals(["interactive", "background"]);
export const SidecarChunkedFrameType = Schema.Literals(["run", "done", "hostCall", "hostResult"]);

export const SidecarRunFrame = Schema.Struct({
	...envelope,
	tier: SidecarTier,
	lane: SidecarLane,
	input: Schema.Json,
	type: Schema.Literal("run"),
	module: Schema.Struct({ sha256: Sha256, source: Schema.String }),
	limits: Schema.Struct({
		cpuMs: boundedInt(SIDECAR_PROTOCOL_LIMITS.execution.cpuMs),
		heapBytes: boundedInt(SIDECAR_PROTOCOL_LIMITS.execution.heapBytes),
		deadlineMs: boundedInt(SIDECAR_PROTOCOL_LIMITS.execution.deadlineMs),
		externalBytes: boundedInt(SIDECAR_PROTOCOL_LIMITS.execution.externalBytes),
	}),
});

export const SidecarHostResultFrame = Schema.Struct({
	...envelope,
	type: Schema.Literal("hostResult"),
	result: Schema.Union([
		Schema.Struct({ value: Schema.Json, status: Schema.Literal("success") }),
		Schema.Struct({ message: Schema.String, status: Schema.Literal("failure") }),
	]),
});

export const SidecarCancelFrame = Schema.Struct({ ...envelope, type: Schema.Literal("cancel") });

export const SidecarPartFrame = Schema.Struct({
	...envelope,
	data: Base64,
	type: Schema.Literal("part"),
	frameType: SidecarChunkedFrameType,
	count: boundedInt({ minimum: 2, maximum: 256 }),
	index: boundedInt({ minimum: 0, maximum: 255 }),
	byteLength: boundedInt({ minimum: 1, maximum: SIDECAR_PROTOCOL_LIMITS.messageBytes.hostResult }),
});

export const SidecarReadyFrame = Schema.Struct({
	generation: Generation,
	type: Schema.Literal("ready"),
});

export const SidecarHostCallFrame = Schema.Struct({
	...envelope,
	args: Schema.Json,
	type: Schema.Literal("hostCall"),
	name: Schema.String.check(
		Schema.isMinLength(1),
		Schema.isMaxLength(SIDECAR_PROTOCOL_LIMITS.nameLength),
	),
});

export const SidecarOutcome = Schema.Union([
	Schema.Struct({ value: Schema.Json, status: Schema.Literal("completed") }),
	Schema.Struct({ status: Schema.Literal("cancelled") }),
	Schema.Struct({
		message: Schema.String,
		status: Schema.Literal("limit"),
		limit: Schema.Literals(["heap", "external", "cpu", "deadline"]),
	}),
	Schema.Struct({
		message: Schema.String,
		status: Schema.Literal("failed"),
		phase: Schema.Literals([
			"protocol",
			"admission",
			"integrity",
			"resolution",
			"evaluation",
			"execution",
			"result",
		]),
	}),
]);

export const SidecarDoneFrame = Schema.Struct({
	...envelope,
	outcome: SidecarOutcome,
	type: Schema.Literal("done"),
	usage: Schema.Struct({
		heapBytes: boundedInt({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
		externalBytes: boundedInt({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
	}),
	console: Schema.Struct({
		truncated: Schema.Boolean,
		entries: Schema.Array(
			Schema.Struct({
				message: Schema.String,
				level: Schema.Literals(["debug", "info", "log", "warn", "error"]),
			}),
		).check(Schema.isMaxLength(SIDECAR_PROTOCOL_LIMITS.consoleEntries)),
	}),
});

export const SidecarDrainingFrame = Schema.Struct({
	generation: Generation,
	type: Schema.Literal("draining"),
	reason: Schema.Literals(["executions", "memory"]),
});

export const SidecarFatalFrame = Schema.Struct({
	handle: Handle,
	generation: Generation,
	type: Schema.Literal("fatal"),
	reason: Schema.Literal("termination-ignored"),
});

export const SidecarInboundFrame = Schema.Union([
	SidecarRunFrame,
	SidecarHostResultFrame,
	SidecarCancelFrame,
	SidecarPartFrame,
]);
export type SidecarInboundFrame = typeof SidecarInboundFrame.Type;

export const SidecarOutboundFrame = Schema.Union([
	SidecarReadyFrame,
	SidecarHostCallFrame,
	SidecarDoneFrame,
	SidecarDrainingFrame,
	SidecarFatalFrame,
	SidecarPartFrame,
]);
export type SidecarOutboundFrame = typeof SidecarOutboundFrame.Type;

export class SidecarProtocolError extends Schema.TaggedError<SidecarProtocolError>()(
	"SidecarProtocolError",
	{ message: Schema.String, reason: Schema.Literals(["framing", "payload"]) },
) {}

const parseOptions = { onExcessProperty: "error" } as const;
const decoder = new TextDecoder("utf-8", { fatal: true });
const sidecarInboundJson = Schema.fromJsonString(SidecarInboundFrame);
const sidecarOutboundJson = Schema.fromJsonString(SidecarOutboundFrame);
const encodeInboundJson = Schema.encodeSync(sidecarInboundJson, parseOptions);
const decodeOutboundJson = Schema.decodeUnknownSync(sidecarOutboundJson, parseOptions);

export const encodeSidecarInboundLogicalMessage = (frame: SidecarInboundFrame) =>
	encodeInboundJson(frame);

export const decodeSidecarOutboundLogicalMessage = (bytes: Uint8Array) => {
	if (bytes.byteLength > SIDECAR_PROTOCOL_LIMITS.messageBytes.done) {
		throw new SidecarProtocolError({
			reason: "payload",
			message: `logical message exceeds ${SIDECAR_PROTOCOL_LIMITS.messageBytes.done} bytes`,
		});
	}
	let frame: SidecarOutboundFrame;
	try {
		frame = decodeOutboundJson(decoder.decode(bytes));
	} catch (error) {
		throw new SidecarProtocolError({
			reason: "payload",
			message: error instanceof Error ? error.message : "invalid logical message",
		});
	}
	let maximumBytes = SIDECAR_PROTOCOL_LIMITS.frameBytes;
	if (frame.type === "hostCall") {
		maximumBytes = SIDECAR_PROTOCOL_LIMITS.messageBytes.hostCall;
	} else if (frame.type === "done") {
		maximumBytes = SIDECAR_PROTOCOL_LIMITS.messageBytes.done;
	}
	if (bytes.byteLength > maximumBytes) {
		throw new SidecarProtocolError({
			reason: "payload",
			message: `logical ${frame.type} message exceeds ${maximumBytes} bytes`,
		});
	}
	return frame;
};

const sidecarFrameCodec = <Frame>(schema: Schema.Codec<Frame, Frame>) => {
	const json = Schema.fromJsonString(schema);
	const encodeJson = Schema.encodeSync(json, parseOptions);
	const decodeJson = Schema.decodeEffect(json, parseOptions);
	return {
		encode: (frame: Frame) => {
			const payload = encodeText(encodeJson(frame));
			const bytes = new Uint8Array(4 + payload.byteLength);
			new DataView(bytes.buffer).setUint32(0, payload.byteLength);
			bytes.set(payload, 4);
			return bytes;
		},
		decode: Effect.fnUntraced(function* (bytes: Uint8Array) {
			if (bytes.byteLength < 4) {
				return yield* new SidecarProtocolError({ reason: "framing", message: "missing length" });
			}
			const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
			if (length === 0 || length > SIDECAR_PROTOCOL_LIMITS.frameBytes) {
				return yield* new SidecarProtocolError({
					reason: "framing",
					message: `frame length ${length} is outside 1..${SIDECAR_PROTOCOL_LIMITS.frameBytes}`,
				});
			}
			if (bytes.byteLength !== 4 + length) {
				return yield* new SidecarProtocolError({
					reason: "framing",
					message: `frame declares ${length} bytes but carries ${bytes.byteLength - 4}`,
				});
			}
			const text = yield* Effect.try({
				try: () => decoder.decode(bytes.subarray(4)),
				catch: () => new SidecarProtocolError({ reason: "payload", message: "invalid UTF-8" }),
			});
			return yield* decodeJson(text).pipe(
				Effect.mapError(
					(error) => new SidecarProtocolError({ reason: "payload", message: error.message }),
				),
			);
		}),
	};
};

export const sidecarInboundFrames = sidecarFrameCodec(SidecarInboundFrame);
export const sidecarOutboundFrames = sidecarFrameCodec(SidecarOutboundFrame);
