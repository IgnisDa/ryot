import {
	exercisePropertiesSchema,
	measurementPropertiesSchema,
	workoutPropertiesSchema,
	workoutSetPropertiesSchema,
	workoutTemplatePropertiesSchema,
} from "./property";

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
			validation: { minimum: 0, maximum: 100 },
			description: "Your personal rating from 0 (lowest) to 100 (highest)",
		},
	},
};

const fitnessEntitySchemaDefinitions = [
	{
		icon: "library",
		eventSchemas: [],
		pluginSlug: "fitness",
		slug: "fitness-library",
		name: "Fitness Library",
		propertiesSchema: { fields: {} },
		userState: { deniedOperations: ["clear", "merge"] },
	},
	{
		icon: "zap",
		slug: "exercise",
		name: "Exercise",
		mergeIdentityProperties: ["kind"],
		propertiesSchema: exercisePropertiesSchema,
		eventSchemas: [
			{ name: "Workout Set", slug: "workout-set", propertiesSchema: workoutSetPropertiesSchema },
			{ name: "Review", slug: "review", propertiesSchema: reviewPropertiesSchema },
		],
	},
	{
		slug: "workout",
		name: "Workout",
		icon: "dumbbell",
		eventSchemas: [],
		propertiesSchema: workoutPropertiesSchema,
	},
	{
		eventSchemas: [],
		icon: "clipboard-list",
		slug: "workout-template",
		name: "Workout Template",
		propertiesSchema: workoutTemplatePropertiesSchema,
	},
	{
		icon: "ruler",
		eventSchemas: [],
		slug: "measurement",
		name: "Measurement",
		propertiesSchema: measurementPropertiesSchema,
	},
] as const;

export const fitnessEntitySchemas = () =>
	fitnessEntitySchemaDefinitions.map((schema) => {
		if (!("pluginSlug" in schema)) {
			return schema;
		}
		const { pluginSlug: _pluginSlug, ...withoutPluginSlug } = schema;
		return withoutPluginSlug;
	});
