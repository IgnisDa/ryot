import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";

export const exerciseMergeOperationSlug = "exercise-merge";

export const ExerciseMergeInputSchema = Schema.Struct({ mergeFrom: EntityId, mergeInto: EntityId });

export const ExerciseMergeOutputSchema = Schema.Struct({ mergeInto: EntityId });
