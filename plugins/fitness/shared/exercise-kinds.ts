import { Schema } from "@ryot-app/plugin-kit/effect";

export const exerciseKinds = [
	"reps",
	"duration",
	"reps_and_weight",
	"reps_and_duration",
	"distance_and_duration",
	"reps_and_duration_and_distance",
] as const;

export const exerciseKindSchema = Schema.Literals(exerciseKinds);
export type ExerciseKind = Schema.Schema.Type<typeof exerciseKindSchema>;
