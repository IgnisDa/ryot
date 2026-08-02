import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import type { GenericImportWriteItem } from "@ryot/sandbox-sdk/imports";

import {
	buildWorkoutSetEventProperties,
	type WorkoutImportItem,
} from "../../import-adapters/workout-domain";

export const toWorkoutWriteItem = (workout: WorkoutImportItem): GenericImportWriteItem => {
	const workoutProperties: Record<string, JsonValue> = { startedAt: workout.startedAt };
	if (workout.endedAt) {
		workoutProperties["endedAt"] = workout.endedAt;
	}
	if (workout.comment) {
		workoutProperties["comment"] = workout.comment;
	}

	return {
		relationships: [],
		itemIndex: workout.itemIndex,
		subjectEntityAlias: "workout",
		sourceLabel: workout.sourceLabel,
		sourceIdentifier: workout.sourceIdentifier,
		entities: [
			...workout.exercises.map((exercise, index) => ({
				name: exercise.name,
				alias: `exercise-${index}`,
				entitySchemaSlug: "exercise",
				properties: { images: [], muscles: [], instructions: [], kind: exercise.kind },
				match: {
					name: exercise.name,
					nameNormalization: "slug" as const,
					properties: { kind: exercise.kind },
				},
			})),
			{
				alias: "workout",
				name: workout.name,
				entitySchemaSlug: "workout",
				properties: workoutProperties,
			},
		],
		events: workout.exercises.flatMap((exercise, exerciseOrder) =>
			exercise.sets.map((set, setOrder) => ({
				occurredAt: workout.startedAt,
				sessionEntityAlias: "workout",
				eventSchemaSlug: "workout-set",
				entityAlias: `exercise-${exerciseOrder}`,
				properties: buildWorkoutSetEventProperties({
					set,
					setOrder,
					exerciseOrder,
					exerciseKind: exercise.kind,
				}),
			})),
		),
	};
};
