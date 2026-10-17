import { exerciseTargetKinds } from "../../shared/taxonomy";
import {
	exercisePropertiesSchema,
	measurementEntryPropertiesSchema,
	measurementMetricPropertiesSchema,
	measurementReadingPropertiesSchema,
	workoutPropertiesSchema,
	workoutRecordPropertiesSchema,
	workoutSetPropertiesSchema,
	workoutTemplatePropertiesSchema,
} from "./property";

const exerciseReviewPropertiesSchema = {
	unknownKeys: "strict" as const,
	fields: {
		text: {
			label: "Note",
			type: "string" as const,
			description: "Your private note about this exercise",
		},
		rating: {
			label: "Rating",
			type: "number" as const,
			validation: { minimum: 0, maximum: 100 },
			description: "Your personal rating from 0 (lowest) to 100 (highest)",
		},
	},
};

export const fitnessEntitySchemas = [
	{
		icon: "library",
		eventSchemas: [],
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
		editor: { relationships: ["exercise-targets", "exercise-uses-equipment"] },
		eventSchemas: [
			{
				name: "Workout Set",
				slug: "workout-set",
				propertiesSchema: workoutSetPropertiesSchema,
				projection: {
					scriptSlug: "script.workout-record-step",
					propertiesSchema: workoutRecordPropertiesSchema,
				},
			},
			{ name: "Review", slug: "review", propertiesSchema: exerciseReviewPropertiesSchema },
		],
	},
	{
		icon: "target",
		eventSchemas: [],
		slug: "exercise-target",
		name: "Exercise Target",
		editor: { relationships: [] },
		propertiesSchema: {
			fields: {
				description: {
					type: "string",
					label: "Description",
					description: "Optional description of this exercise target",
				},
				kind: {
					type: "enum",
					label: "Kind",
					validation: { required: true },
					description: "Type of anatomical target",
					choices: { kind: "static", values: exerciseTargetKinds.map((value) => ({ value })) },
				},
			},
		},
	},
	{
		icon: "dumbbell",
		eventSchemas: [],
		slug: "exercise-equipment",
		name: "Exercise Equipment",
		editor: { relationships: [] },
		propertiesSchema: {
			fields: {
				description: {
					type: "string",
					label: "Description",
					description: "Optional description of this exercise equipment",
				},
			},
		},
	},
	{
		slug: "workout",
		name: "Workout",
		icon: "dumbbell",
		propertiesSchema: workoutPropertiesSchema,
		eventSchemas: [
			{
				slug: "workout-completed",
				name: "Workout completed",
				propertiesSchema: {
					unknownKeys: "strict",
					fields: {
						workoutName: {
							type: "string",
							label: "Workout name",
							description: "Workout name at completion",
							validation: { minLength: 1, required: true },
						},
					},
				},
			},
		],
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
		slug: "measurement-entry",
		name: "Measurement Entry",
		userState: { deniedOperations: ["merge"] },
		propertiesSchema: measurementEntryPropertiesSchema,
	},
	{
		icon: "ruler",
		slug: "measurement-metric",
		name: "Measurement Metric",
		propertiesSchema: measurementMetricPropertiesSchema,
		eventSchemas: [
			{
				name: "Measurement Reading",
				slug: "measurement-reading",
				propertiesSchema: measurementReadingPropertiesSchema,
			},
		],
	},
] as const;
