import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";
import type { LocalMessage } from "@ryot-app/plugin-kit/messages";

/** A media-authored failure; host capability failures retain their SandboxHostError channel. */
export class MediaSandboxError extends Schema.TaggedError<
	MediaSandboxError,
	{ readonly brand: unique symbol }
>()("MediaSandboxError", { message: Schema.String }) {}

export const reject = (reason: LocalMessage) => Effect.fail(new OperationRejectedError({ reason }));
