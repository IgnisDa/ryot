import { Schema } from "@ryot-app/plugin-client-sdk/effect";

export class WorkoutEditorPrepareError extends Schema.TaggedError<
	WorkoutEditorPrepareError,
	{ readonly brand: unique symbol }
>()("WorkoutEditorPrepareError", { message: Schema.String }) {}
