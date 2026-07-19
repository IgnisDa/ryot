export const fitnessRelationshipSchemas = () =>
	[
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
