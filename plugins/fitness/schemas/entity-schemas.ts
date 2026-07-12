import {
	exercisePropertiesSchema,
	measurementPropertiesSchema,
	workoutPropertiesSchema,
	workoutSetPropertiesSchema,
	workoutTemplatePropertiesSchema,
} from "./property-schemas";

const reviewPropertiesSchema = {
	fields: {
		text: {
			label: "Review",
			type: "string" as const,
			description: "Your written thoughts or notes about this media",
		},
		isSpoiler: {
			label: "Is Spoiler?",
			type: "boolean" as const,
			description: "Whether this review contains spoilers",
		},
		rating: {
			label: "Rating",
			type: "number" as const,
			validation: { maximum: 100, minimum: 0 },
			description: "Your personal rating from 0 (lowest) to 100 (highest)",
		},
	},
};

export const fitnessEntitySchemas = () =>
	[
		{
			icon: "zap",
			slug: "exercise",
			name: "Exercise",
			accentColor: "#14B8A6",
			mergeIdentityProperties: ["kind"],
			propertiesSchema: exercisePropertiesSchema,
			eventSchemas: [
				{
					name: "Workout Set",
					slug: "workout-set",
					propertiesSchema: workoutSetPropertiesSchema,
				},
				{ name: "Review", slug: "review", propertiesSchema: reviewPropertiesSchema },
			],
		},
		{
			slug: "workout",
			name: "Workout",
			icon: "dumbbell",
			eventSchemas: [],
			accentColor: "#84CC16",
			propertiesSchema: workoutPropertiesSchema,
		},
		{
			eventSchemas: [],
			icon: "clipboard-list",
			accentColor: "#A3E635",
			slug: "workout-template",
			name: "Workout Template",
			propertiesSchema: workoutTemplatePropertiesSchema,
		},
		{
			icon: "ruler",
			eventSchemas: [],
			slug: "measurement",
			name: "Measurement",
			accentColor: "#6366F1",
			propertiesSchema: measurementPropertiesSchema,
		},
	] as const;
