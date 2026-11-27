import { Effect, Schema } from "effect";
import { Base64 } from "effect/encoding";

import { SidecarHostCallFrame } from "../protocol/messages";

export const encodeJson = (value: unknown) =>
	Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(value).pipe(Effect.orDie);

export const hostCallArgs = (value: unknown) =>
	Effect.map(encodeJson(value), (text) => Base64.encode(new TextEncoder().encode(text)));

export const decodedHostCallArgs = (encoded: string) =>
	Effect.fromResult(Base64.decode(encoded)).pipe(
		Effect.flatMap((bytes) =>
			Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(new TextDecoder().decode(bytes)),
		),
		Effect.orDie,
	);

export const hostCallFrame = (
	frame: { readonly args: unknown } & Omit<typeof SidecarHostCallFrame.Encoded, "args" | "type">,
) =>
	hostCallArgs(frame.args).pipe(
		Effect.flatMap((args) =>
			Schema.decodeEffect(SidecarHostCallFrame)({ ...frame, args, type: "hostCall" }),
		),
		Effect.orDie,
	);
