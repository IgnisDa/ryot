import { reviewRatingField } from "@ryot-app/plugin-kit/schema";

import { catalogMessage } from "../../shared/messages.generated";
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
import { workoutExercisePropertiesSchema } from "./workout-taxonomy";

const exerciseReviewPropertiesSchema = {
	unknownKeys: "strict" as const,
	fields: {
		rating: reviewRatingField,
		text: {
			type: "string" as const,
			label: catalogMessage("property.note"),
			description: "Your private note about this exercise",
		},
	},
};

export const fitnessEntitySchemas = [
	{
		icon: "library",
		eventSchemas: [],
		slug: "fitness-library",
		propertiesSchema: { fields: {} },
		userState: { deniedOperations: ["clear", "merge"] },
		name: catalogMessage("entity-schema.fitness-library.name"),
	},
	{
		icon: "zap",
		slug: "exercise",
		mergeIdentityProperties: ["kind"],
		propertiesSchema: exercisePropertiesSchema,
		name: catalogMessage("entity-schema.exercise.name"),
		fold: { eventSchemaSlugs: ["workout-set"], scriptSlug: "fold.exercise-records" },
		editor: {
			relationships: [
				{ slug: "exercise-targets", direction: "outgoing" as const },
				{ direction: "outgoing" as const, slug: "exercise-uses-equipment" },
			],
		},
		eventSchemas: [
			{
				slug: "workout-exercise",
				propertiesSchema: workoutExercisePropertiesSchema,
				name: catalogMessage("event-schema.exercise.workout-exercise.name"),
				eventGroup: {
					keyProperties: ["exerciseOrder"],
					immutableProperties: ["exerciseKind", "targets", "equipment"],
					dependents: [
						{ eventSchemaSlug: "workout-set", matchProperties: ["exerciseOrder", "exerciseKind"] },
					],
				},
			},
			{
				slug: "workout-set",
				propertiesSchema: workoutSetPropertiesSchema,
				name: catalogMessage("event-schema.exercise.workout-set.name"),
				projection: { propertiesSchema: workoutRecordPropertiesSchema },
			},
			{
				slug: "review",
				propertiesSchema: exerciseReviewPropertiesSchema,
				name: catalogMessage("event-schema.exercise.review.name"),
			},
		],
	},
	{
		icon: "target",
		eventSchemas: [],
		slug: "exercise-target",
		editor: { relationships: [] },
		name: catalogMessage("entity-schema.exercise-target.name"),
		propertiesSchema: {
			fields: {
				description: {
					type: "string",
					label: catalogMessage("property.description"),
					description: "Optional description of this exercise target",
				},
				kind: {
					type: "enum",
					validation: { required: true },
					label: catalogMessage("property.kind"),
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
		editor: { relationships: [] },
		name: catalogMessage("entity-schema.exercise-equipment.name"),
		propertiesSchema: {
			fields: {
				description: {
					type: "string",
					label: catalogMessage("property.description"),
					description: "Optional description of this exercise equipment",
				},
			},
		},
	},
	{
		slug: "workout",
		icon: "dumbbell",
		propertiesSchema: workoutPropertiesSchema,
		name: catalogMessage("entity-schema.workout.name"),
		eventSchemas: [
			{
				slug: "workout-completed",
				name: catalogMessage("event-schema.workout.workout-completed.name"),
				propertiesSchema: {
					unknownKeys: "strict",
					fields: {
						workoutName: {
							type: "string",
							description: "Workout name at completion",
							validation: { minLength: 1, required: true },
							label: catalogMessage("property.workout-name"),
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
		propertiesSchema: workoutTemplatePropertiesSchema,
		name: catalogMessage("entity-schema.workout-template.name"),
	},
	{
		icon: "ruler",
		eventSchemas: [],
		slug: "measurement-entry",
		userState: { deniedOperations: ["merge"] },
		propertiesSchema: measurementEntryPropertiesSchema,
		name: catalogMessage("entity-schema.measurement-entry.name"),
	},
	{
		icon: "ruler",
		slug: "measurement-metric",
		propertiesSchema: measurementMetricPropertiesSchema,
		name: catalogMessage("entity-schema.measurement-metric.name"),
		eventSchemas: [
			{
				slug: "measurement-reading",
				propertiesSchema: measurementReadingPropertiesSchema,
				name: catalogMessage("event-schema.measurement-metric.measurement-reading.name"),
			},
		],
	},
] as const;
