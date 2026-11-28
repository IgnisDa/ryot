import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

/** A media-authored failure; host capability failures retain their SandboxHostError channel. */
export class MediaSandboxError extends Schema.TaggedError<
	MediaSandboxError,
	{ readonly brand: unique symbol }
>()("MediaSandboxError", { message: Schema.String }) {}
