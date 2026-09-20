import { exerciseTargetRoles } from "../../shared/taxonomy";

export const fitnessRelationshipSchemas = () =>
	[
		{
			slug: "in-fitness-library",
			name: "In Fitness Library",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: "exercise",
			targetEntitySchemaSlug: "fitness-library",
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
