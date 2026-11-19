import type { LocalMessage } from "@ryot-app/plugin-kit/messages";

import type {
	ExerciseForce,
	ExerciseKind,
	ExerciseLevel,
	ExerciseMechanic,
} from "./exercise-kinds";
import { catalogMessage } from "./messages.generated";

export const exerciseKindLabels = {
	reps: catalogMessage("browse.exercise-kind.reps"),
	duration: catalogMessage("browse.exercise-kind.duration"),
	reps_and_weight: catalogMessage("browse.exercise-kind.reps-and-weight"),
	reps_and_duration: catalogMessage("browse.exercise-kind.reps-and-duration"),
	distance_and_duration: catalogMessage("browse.exercise-kind.distance-and-duration"),
	reps_and_duration_and_distance: catalogMessage(
		"browse.exercise-kind.reps-and-duration-and-distance",
	),
} satisfies Record<ExerciseKind, LocalMessage>;

export const exerciseForceLabels = {
	pull: catalogMessage("browse.exercise-force.pull"),
	push: catalogMessage("browse.exercise-force.push"),
	static: catalogMessage("browse.exercise-force.static"),
} satisfies Record<ExerciseForce, LocalMessage>;

export const exerciseLevelLabels = {
	expert: catalogMessage("browse.exercise-level.expert"),
	beginner: catalogMessage("browse.exercise-level.beginner"),
	intermediate: catalogMessage("browse.exercise-level.intermediate"),
} satisfies Record<ExerciseLevel, LocalMessage>;

export const exerciseMechanicLabels = {
	compound: catalogMessage("browse.exercise-mechanic.compound"),
	isolation: catalogMessage("browse.exercise-mechanic.isolation"),
} satisfies Record<ExerciseMechanic, LocalMessage>;
