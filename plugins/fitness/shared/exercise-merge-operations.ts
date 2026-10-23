import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";

export const exerciseMergeOperationSlug = "exercise-merge";

export const ExerciseMergeInputSchema = Schema.Struct({ mergeFrom: EntityId, mergeInto: EntityId });

export const ExerciseMergeOutputSchema = Schema.Union([
	Schema.Struct({ mergeInto: EntityId, kind: Schema.Literal("merged") }),
	Schema.Struct({ kind: Schema.Literal("not-custom") }),
	Schema.Struct({ kind: Schema.Literal("kind-mismatch") }),
	Schema.Struct({ kind: Schema.Literal("missing") }),
	Schema.Struct({ kind: Schema.Literal("same") }),
]);
