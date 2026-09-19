import type { GenericImportWriteItem } from "@ryot-app/sandbox-sdk/imports";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

import { buildWorkoutSetEventProperties, type WorkoutImportItem } from "./workout-domain";

export const toWorkoutWriteItem = (workout: WorkoutImportItem): GenericImportWriteItem => {
	const operationId = (...parts: Array<string | number>) =>
		JSON.stringify(["workout", workout.itemIndex, ...parts]);
	const workoutProperties: Record<string, JsonValue> = { startedAt: workout.startedAt };
	if (workout.endedAt) {
		workoutProperties["endedAt"] = workout.endedAt;
	}
	if (workout.comment) {
		workoutProperties["comment"] = workout.comment;
	}

	return {
		itemIndex: workout.itemIndex,
		subjectEntityAlias: "workout",
		sourceLabel: workout.sourceLabel,
		sourceIdentifier: workout.sourceIdentifier,
		recordId: JSON.stringify(["workout", workout.itemIndex]),
		relationships: workout.exercises.map((_exercise, index) => ({
			properties: {},
			targetAlias: "fitness-library",
			propertiesMode: "merge" as const,
			sourceAlias: `exercise-${index}`,
			relationshipSchemaSlug: "in-fitness-library",
			operationId: operationId("exercise-membership", index),
		})),
		events: workout.exercises.flatMap((exercise, exerciseOrder) =>
			exercise.sets.map((set, setOrder) => ({
				occurredAt: workout.startedAt,
				sessionEntityAlias: "workout",
				eventSchemaSlug: "workout-set",
				entityAlias: `exercise-${exerciseOrder}`,
				outcome: { unit: "sets", recordKind: "workout-sets" },
				operationId: operationId("set", exerciseOrder, setOrder),
				properties: buildWorkoutSetEventProperties({
					set,
					setOrder,
					exerciseOrder,
					exerciseKind: exercise.kind,
				}),
				attribution: {
					sourceLabel: workout.sourceLabel,
					sourceIdentifier: workout.sourceIdentifier,
					recordId: JSON.stringify(["workout", workout.itemIndex]),
				},
			})),
		),
		entities: [
			...workout.exercises.map((exercise, index) => ({
				name: exercise.name,
				scope: "user" as const,
				alias: `exercise-${index}`,
				entitySchemaSlug: "exercise",
				operationId: operationId("exercise", index),
				properties: { images: [], instructions: [], kind: exercise.kind },
				match: {
					name: exercise.name,
					nameNormalization: "slug" as const,
					properties: { kind: exercise.kind },
				},
				providerResolution: {
					value: exercise.name,
					identifierType: "name",
					providerSlug: "exercise.free-exercise-db",
				},
			})),
			...(workout.exercises.length > 0
				? [
						{
							properties: {},
							existingOnly: true,
							scope: "user" as const,
							name: "Fitness Library",
							alias: "fitness-library",
							entitySchemaSlug: "fitness-library",
							operationId: operationId("fitness-library"),
							match: { properties: {}, name: "Fitness Library" },
						},
					]
				: []),
			{
				alias: "workout",
				name: workout.name,
				entitySchemaSlug: "workout",
				properties: workoutProperties,
				operationId: operationId("entity"),
				outcome: { unit: "workouts", recordKind: "workouts" },
			},
		],
	};
};
