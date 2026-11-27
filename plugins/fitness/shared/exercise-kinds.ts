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

export const exerciseForces = ["pull", "push", "static"] as const;
export const exerciseLevels = ["beginner", "intermediate", "expert"] as const;
export const exerciseMechanics = ["compound", "isolation"] as const;

export const exerciseForceSchema = Schema.Literals(exerciseForces);
export const exerciseLevelSchema = Schema.Literals(exerciseLevels);
export const exerciseMechanicSchema = Schema.Literals(exerciseMechanics);
export type ExerciseForce = typeof exerciseForceSchema.Type;
export type ExerciseLevel = typeof exerciseLevelSchema.Type;
export type ExerciseMechanic = typeof exerciseMechanicSchema.Type;
