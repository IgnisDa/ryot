import { Effect, Schema } from "effect";

import { framePayload } from "./framing";
import {
	SIDECAR_PROTOCOL_LIMITS,
	SidecarInboundFrame,
	SidecarOutboundFrame,
	SidecarProtocolError,
} from "./messages";

const parseOptions = { onExcessProperty: "error" } as const;
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

const sidecarFrameCodec = <Frame>(schema: Schema.Codec<Frame, Frame>) => {
	const json = Schema.fromJsonString(schema);
	const encodeJson = Schema.encodeSync(json, parseOptions);
	const decodeJson = Schema.decodeEffect(json, parseOptions);
	return {
		encode: (frame: Frame) => framePayload(encoder.encode(encodeJson(frame))),
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
