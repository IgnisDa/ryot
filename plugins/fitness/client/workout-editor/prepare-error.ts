import { LocalMessage } from "@ryot-app/plugin-client-sdk";
import { Schema } from "@ryot-app/plugin-client-sdk/effect";

export class WorkoutEditorPrepareError extends Schema.TaggedError<
	WorkoutEditorPrepareError,
	{ readonly brand: unique symbol }
>()("WorkoutEditorPrepareError", { reason: LocalMessage }) {}
