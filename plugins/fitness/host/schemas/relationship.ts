import { exerciseTargetRoles } from "../../shared/taxonomy";

export const fitnessRelationshipSchemas = () =>
	[
		{
			slug: "in-fitness-library",
			name: "In Fitness Library",
			sourceEntitySchemaSlug: "exercise",
			targetEntitySchemaSlug: "fitness-library",
			propertiesSchema: {
				fields: {
					dropRestTime: {
						type: "integer",
						label: "Drop set rest",
						validation: { minimum: 0 },
						description: "Drop set rest override in seconds; zero disables rest",
					},
					normalRestTime: {
						type: "integer",
						label: "Normal set rest",
						validation: { minimum: 0 },
						description: "Normal set rest override in seconds; zero disables rest",
					},
					warmUpRestTime: {
						type: "integer",
						label: "Warm-up set rest",
						validation: { minimum: 0 },
						description: "Warm-up set rest override in seconds; zero disables rest",
					},
					failureRestTime: {
						type: "integer",
						label: "Failure set rest",
						validation: { minimum: 0 },
						description: "Failure set rest override in seconds; zero disables rest",
					},
					defaultDurationUnit: {
						type: "enum",
						label: "Duration unit",
						choices: { kind: "static", values: [{ value: "seconds" }, { value: "minutes" }] },
						description: "Preferred set duration display unit; recorded durations stay in seconds",
					},
				},
			},
		},
		{
			slug: "exercise-targets",
			name: "Exercise Targets",
			sourceEntitySchemaSlug: "exercise",
			targetEntitySchemaSlug: "exercise-target",
			propertiesSchema: {
				fields: {
					role: {
						type: "enum",
						label: "Role",
						description: "How this target is involved in the exercise",
						choices: { kind: "static", values: exerciseTargetRoles.map((value) => ({ value })) },
					},
				},
			},
		},
		{
			slug: "exercise-uses-equipment",
			name: "Exercise Uses Equipment",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: "exercise",
			targetEntitySchemaSlug: "exercise-equipment",
		},
		{
			slug: "workout-repeated-from",
			name: "Workout Repeated From",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: "workout",
			targetEntitySchemaSlug: "workout",
		},
		{
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: "workout",
			slug: "workout-to-workout-template",
			name: "Workout to Workout Template",
			targetEntitySchemaSlug: "workout-template",
		},
	] as const;
