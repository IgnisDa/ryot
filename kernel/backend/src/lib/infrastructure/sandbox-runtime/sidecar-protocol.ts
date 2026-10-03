import { Data, Effect, Schema } from "effect";

const KiB = 1024;
const MiB = 1024 * KiB;

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
const Base64 = Schema.String.check(
	Schema.isPattern(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
);
const Seq = boundedInt({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const Generation = boundedInt({ minimum: 0, maximum: 4_294_967_295 });

const envelope = { seq: Seq, handle: Handle, generation: Generation };

export const SidecarTier = Schema.Literals(["core", "data", "full"]);
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

export class SidecarProtocolError extends Data.TaggedError("SidecarProtocolError")<{
	reason: "framing" | "payload";
	message: string;
}> {}

const parseOptions = { onExcessProperty: "error" } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const sidecarFrameCodec = <Frame>(schema: Schema.Codec<Frame, Frame>) => {
	const json = Schema.fromJsonString(schema);
	const encodeJson = Schema.encodeSync(json, parseOptions);
	const decodeJson = Schema.decodeEffect(json, parseOptions);
	return {
		encode: (frame: Frame) => {
			const payload = encoder.encode(encodeJson(frame));
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
