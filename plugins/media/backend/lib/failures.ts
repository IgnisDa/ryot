import { Schema } from "@ryot-app/sandbox-sdk/effect";

/** A media-authored failure; host capability failures retain their SandboxHostError channel. */
export class MediaSandboxError extends Schema.TaggedError<MediaSandboxError>()(
	"MediaSandboxError",
	{ message: Schema.String },
) {}
