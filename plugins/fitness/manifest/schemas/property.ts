import type {
	AuthoredAppSchema,
	AuthoredSchemaText,
} from "@ryot-app/contract/modules/plugins/manifest-text";
import { imagesField, videosField } from "@ryot-app/contract/schema/core";
import type { AppPropertyDefinition } from "@ryot-app/contract/schema/property-schema";

import {
	exerciseForces,
	exerciseKinds,
	exerciseLevels,
	exerciseMechanics,
} from "../../shared/exercise-kinds";
import { catalogMessage } from "../../shared/messages.generated";
import { personalBestTypes, workoutSetScales } from "../../shared/workout-records";
import {
	workoutSetDerivedFields,
	type WorkoutSetField,
	workoutSetLots,
} from "../../shared/workout-set";

const workoutSupersetItemProperties: Readonly<
	Record<string, AppPropertyDefinition<AuthoredSchemaText>>
> = {
	color: {
		type: "string",
		validation: { required: true },
		label: catalogMessage("property.color"),
		description: "Display color for this superset",
	},
	exercises: {
		type: "array",
		validation: { required: true },
		label: catalogMessage("property.exercises"),
		description: "Zero-based exercise positions in this superset",
		items: {
			type: "integer",
			description: "Item",
			validation: { minimum: 0 },
			label: catalogMessage("property.item"),
		},
	},
};

export const exercisePropertiesSchema: AuthoredAppSchema = {
	fields: {
		videos: videosField("Demonstration videos for this exercise"),
		images: imagesField("Cover and demonstration images for this exercise"),
		instructions: {
			type: "array",
			label: catalogMessage("property.instructions"),
			description: "Step-by-step instructions for performing this exercise",
			items: { type: "string", description: "Item", label: catalogMessage("property.item") },
		},
		kind: {
			type: "enum",
			immutable: true,
			validation: { required: true },
			label: catalogMessage("property.kind"),
			description: "Which measurements are used to track sets of this exercise",
			choices: { kind: "static", values: exerciseKinds.map((value) => ({ value })) },
		},

		force: {
			type: "enum",
			label: catalogMessage("property.force"),
			description: "Direction of force applied: pull, push, or static hold",
			choices: { kind: "static", values: exerciseForces.map((value) => ({ value })) },
		},

		mechanic: {
			type: "enum",
			label: catalogMessage("property.mechanic"),
			choices: { kind: "static", values: exerciseMechanics.map((value) => ({ value })) },
			description:
				"Whether the exercise uses multiple joints (compound) or a single joint (isolation)",
		},

		level: {
			type: "enum",
			label: catalogMessage("property.level"),
			description: "Recommended experience level: beginner, intermediate, or expert",
			choices: { kind: "static", values: exerciseLevels.map((value) => ({ value })) },
		},
	},
};

const workoutSetFields: Record<WorkoutSetField, AppPropertyDefinition<AuthoredSchemaText>> = {
	note: {
		type: "string",
		label: catalogMessage("property.note"),
		description: "Optional note specific to this set",
	},
	confirmedAt: {
		type: "datetime",
		label: catalogMessage("property.confirmed-at"),
		description: "Date and time this set was confirmed by the user",
	},
	restTimerStartedAt: {
		type: "datetime",
		label: catalogMessage("property.rest-timer-started-at"),
		description: "Date and time the rest timer was started after this set",
	},
	setOrder: {
		type: "integer",
		validation: { minimum: 0 },
		label: catalogMessage("property.set-order"),
		description: "Zero-based position of this set within the exercise",
	},
	reps: {
		type: "integer",
		validation: { minimum: 0 },
		label: catalogMessage("property.reps"),
		description: "Nonnegative whole number of repetitions performed in this set",
	},
	exerciseOrder: {
		type: "integer",
		validation: { minimum: 0 },
		label: catalogMessage("property.exercise-order"),
		description: "Zero-based position of this exercise within the workout",
	},
	restTime: {
		type: "integer",
		validation: { minimum: 0 },
		label: catalogMessage("property.planned-rest"),
		description: "Planned rest after this set in seconds, not measured elapsed rest",
	},
	rpe: {
		type: "integer",
		label: catalogMessage("property.rpe"),
		validation: { minimum: 0, maximum: 10 },
		description: "Rate of perceived exertion from 0 (no effort) to 10 (maximal effort)",
	},
	setLot: {
		type: "enum",
		label: catalogMessage("property.set-lot"),
		description: "Set type: normal, warm_up, drop, or failure",
		choices: { kind: "static", values: workoutSetLots.map((value) => ({ value })) },
	},
	duration: {
		type: "number",
		validation: { minimum: 0 },
		label: catalogMessage("property.duration"),
		description: "Duration of this set in seconds",
		normalize: { round: { scale: workoutSetScales.duration } },
	},
	weight: {
		type: "number",
		validation: { minimum: 0 },
		label: catalogMessage("property.weight"),
		normalize: { round: { scale: workoutSetScales.weight } },
		description: "Weight used in this set in kilograms (kg)",
	},
	oneRm: {
		type: "number",
		validation: { minimum: 0 },
		label: catalogMessage("property.one-rm"),
		normalize: { round: { scale: workoutSetScales.oneRm } },
		description: "One-rep max calculated for this set in kilograms (kg)",
	},
	distance: {
		type: "number",
		validation: { minimum: 0 },
		label: catalogMessage("property.distance"),
		normalize: { round: { scale: workoutSetScales.distance } },
		description: "Distance covered in this set in kilometers (km)",
	},
	volume: {
		type: "number",
		validation: { minimum: 0 },
		label: catalogMessage("property.volume"),
		normalize: { round: { scale: workoutSetScales.volume } },
		description: "Volume (kilograms × repetitions) calculated for this set",
	},
	pace: {
		type: "number",
		validation: { minimum: 0 },
		label: catalogMessage("property.pace"),
		normalize: { round: { scale: workoutSetScales.pace } },
		description: "Speed calculated as kilometers per second from canonical metric measurements",
	},
	exerciseKind: {
		type: "enum",
		validation: { required: true },
		label: catalogMessage("property.exercise-kind"),
		description: "Exercise kind this set was logged under",
		choices: { kind: "static", values: exerciseKinds.map((value) => ({ value })) },
	},
	personalBests: {
		type: "array",
		validation: { required: true },
		label: catalogMessage("property.personal-bests"),
		description: "Personal bests achieved in this set",
		items: {
			type: "enum",
			description: "Item",
			label: catalogMessage("property.item"),
			choices: { kind: "static", values: personalBestTypes.map((value) => ({ value })) },
		},
	},
};

export const workoutSetPropertiesSchema: AuthoredAppSchema = {
	unknownKeys: "strict",
	fields: Object.fromEntries(
		Object.entries(workoutSetFields).filter(
			([key]) => !workoutSetDerivedFields.some((derived) => derived === key),
		),
	),
};

export const workoutRecordPropertiesSchema: AuthoredAppSchema = {
	unknownKeys: "strict",
	fields: Object.fromEntries(workoutSetDerivedFields.map((key) => [key, workoutSetFields[key]])),
};

export const workoutPropertiesSchema: AuthoredAppSchema = {
	fields: {
		images: imagesField("Images attached to this workout"),
		videos: videosField("Videos attached to this workout"),
		endedAt: {
			type: "datetime",
			label: catalogMessage("property.ended-at"),
			description: "Date and time this workout session ended",
		},
		comment: {
			type: "string",
			label: catalogMessage("property.comment"),
			description: "Optional notes or comments about this workout",
		},
		startedAt: {
			type: "datetime",
			validation: { required: true },
			label: catalogMessage("property.started-at"),
			description: "Date and time this workout session began",
		},
		caloriesBurnt: {
			type: "number",
			validation: { minimum: 0 },
			label: catalogMessage("property.calories-burnt"),
			description: "Estimated energy burned during this workout in kilocalories (kcal)",
		},
		activeDuration: {
			type: "integer",
			validation: { minimum: 0 },
			label: catalogMessage("property.active-duration"),
			description: "Recorded workout duration in seconds, including rests but excluding pauses",
		},
		supersets: {
			type: "array",
			label: catalogMessage("property.supersets"),
			description: "Superset groupings for this workout",
			items: {
				type: "object",
				unknownKeys: "strict",
				label: catalogMessage("property.item"),
				properties: workoutSupersetItemProperties,
				description: "Superset grouping within a workout or template",
			},
		},
		exerciseMedia: {
			type: "array",
			label: catalogMessage("property.exercise-media"),
			description: "Images and videos for each exercise occurrence in this workout",
			items: {
				type: "object",
				unknownKeys: "strict",
				label: catalogMessage("property.item"),
				description: "Media for an exercise occurrence",
				properties: {
					images: imagesField("Images attached to this exercise occurrence in the workout"),
					videos: videosField("Videos attached to this exercise occurrence in the workout"),
					exerciseOrder: {
						type: "integer",
						validation: { minimum: 0, required: true },
						label: catalogMessage("property.exercise-order"),
						description: "Zero-based position of this exercise within the workout",
					},
				},
			},
		},
		exerciseNotes: {
			type: "array",
			label: catalogMessage("property.exercise-notes"),
			description: "Notes for each exercise occurrence in this workout",
			items: {
				type: "object",
				unknownKeys: "strict",
				label: catalogMessage("property.item"),
				description: "Notes for an exercise occurrence",
				properties: {
					exerciseOrder: {
						type: "integer",
						validation: { minimum: 0, required: true },
						label: catalogMessage("property.exercise-order"),
						description: "Zero-based position of this exercise within the workout",
					},
					notes: {
						type: "array",
						validation: { required: true },
						description: "Notes for this exercise",
						label: catalogMessage("property.notes"),
						items: { type: "string", description: "Item", label: catalogMessage("property.item") },
					},
				},
			},
		},
	},
};

const workoutTemplateSetProperties: Readonly<
	Record<string, AppPropertyDefinition<AuthoredSchemaText>>
> = {
	note: {
		type: "string",
		label: catalogMessage("property.note"),
		description: "Optional note specific to this set",
	},
	reps: {
		type: "integer",
		validation: { minimum: 0 },
		label: catalogMessage("property.reps"),
		description: "Nonnegative whole number of repetitions planned for this set",
	},
	restTime: {
		type: "integer",
		validation: { minimum: 0 },
		label: catalogMessage("property.planned-rest"),
		description: "Planned rest after this set in seconds; zero disables rest",
	},
	setOrder: {
		type: "integer",
		validation: { minimum: 0, required: true },
		label: catalogMessage("property.set-order"),
		description: "Zero-based position of this set within the exercise",
	},
	rpe: {
		type: "integer",
		label: catalogMessage("property.rpe"),
		validation: { minimum: 0, maximum: 10 },
		description: "Planned rate of perceived exertion from 0 (no effort) to 10 (maximal effort)",
	},
	weight: {
		type: "number",
		validation: { minimum: 0 },
		label: catalogMessage("property.weight"),
		normalize: { round: { scale: workoutSetScales.weight } },
		description: "Weight planned for this set in kilograms (kg)",
	},
	duration: {
		type: "number",
		validation: { minimum: 0 },
		label: catalogMessage("property.duration"),
		description: "Duration planned for this set in seconds",
		normalize: { round: { scale: workoutSetScales.duration } },
	},
	distance: {
		type: "number",
		validation: { minimum: 0 },
		label: catalogMessage("property.distance"),
		normalize: { round: { scale: workoutSetScales.distance } },
		description: "Distance planned for this set in kilometers (km)",
	},
	setLot: {
		type: "enum",
		validation: { required: true },
		label: catalogMessage("property.set-lot"),
		description: "Set type: normal, warm_up, drop, or failure",
		choices: { kind: "static", values: workoutSetLots.map((value) => ({ value })) },
	},
};

const workoutTemplateExerciseProperties: Readonly<
	Record<string, AppPropertyDefinition<AuthoredSchemaText>>
> = {
	images: imagesField("Images attached to this exercise in the template"),
	videos: videosField("Videos attached to this exercise in the template"),
	exerciseId: {
		type: "string",
		validation: { required: true },
		description: "Entity id of the exercise",
		label: catalogMessage("property.exercise-id"),
	},
	exerciseOrder: {
		type: "integer",
		validation: { minimum: 0, required: true },
		label: catalogMessage("property.exercise-order"),
		description: "Zero-based position of this exercise within the template",
	},
	notes: {
		type: "array",
		validation: { required: true },
		description: "Notes for this exercise",
		label: catalogMessage("property.notes"),
		items: { type: "string", description: "Item", label: catalogMessage("property.item") },
	},
	sets: {
		type: "array",
		validation: { required: true },
		label: catalogMessage("property.sets"),
		description: "Sets planned for this exercise",
		items: {
			type: "object",
			unknownKeys: "strict",
			label: catalogMessage("property.item"),
			properties: workoutTemplateSetProperties,
			description: "Set planned in this exercise",
		},
	},
};

export const workoutTemplatePropertiesSchema: AuthoredAppSchema = {
	fields: {
		images: imagesField("Images attached to this template"),
		videos: videosField("Videos attached to this template"),
		comment: {
			type: "string",
			label: catalogMessage("property.comment"),
			description: "Optional notes about this workout template",
		},
		exercises: {
			type: "array",
			description: "Exercises in this template",
			label: catalogMessage("property.exercises"),
			items: {
				type: "object",
				unknownKeys: "strict",
				label: catalogMessage("property.item"),
				description: "Exercise in this template",
				properties: workoutTemplateExerciseProperties,
			},
		},
		supersets: {
			type: "array",
			description: "Supersets in this template",
			label: catalogMessage("property.supersets"),
			items: {
				type: "object",
				unknownKeys: "strict",
				label: catalogMessage("property.item"),
				properties: workoutSupersetItemProperties,
				description: "Superset grouping within a workout or template",
			},
		},
	},
};

export const measurementMetricPropertiesSchema: AuthoredAppSchema = {
	fields: {
		unit: {
			type: "string",
			label: catalogMessage("property.unit"),
			description: "Unit readings of this metric are recorded in",
		},
		key: {
			type: "string",
			validation: { required: true },
			label: catalogMessage("property.key"),
			description: "Stable identifier of this metric within the user's measurements",
		},
	},
};

export const measurementEntryPropertiesSchema: AuthoredAppSchema = {
	unknownKeys: "strict",
	fields: {
		comment: {
			type: "string",
			label: catalogMessage("property.comment"),
			description: "Optional notes about this entry",
		},
		occurredAt: {
			type: "datetime",
			validation: { required: true },
			label: catalogMessage("property.taken-at"),
			description: "Time this measurement entry was recorded",
		},
	},
};

export const measurementReadingPropertiesSchema: AuthoredAppSchema = {
	unknownKeys: "strict",
	fields: {
		value: {
			type: "number",
			validation: { required: true },
			label: catalogMessage("property.value"),
			description: "Recorded value of the metric",
		},
	},
};
