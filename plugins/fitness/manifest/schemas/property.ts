import { imagesField, videosField } from "@ryot-app/contract/schema/core";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";

import {
	exerciseForces,
	exerciseKinds,
	exerciseLevels,
	exerciseMechanics,
} from "../../shared/exercise-kinds";
import { personalBestTypes, workoutSetScales } from "../../shared/workout-records";
import {
	workoutSetDerivedFields,
	type WorkoutSetField,
	workoutSetLots,
} from "../../shared/workout-set";

const workoutSupersetItemProperties: Readonly<Record<string, AppPropertyDefinition>> = {
	color: {
		type: "string",
		label: "Color",
		validation: { required: true },
		description: "Display color for this superset",
	},
	exercises: {
		type: "array",
		label: "Exercises",
		validation: { required: true },
		description: "Zero-based exercise positions in this superset",
		items: { label: "Item", type: "integer", description: "Item", validation: { minimum: 0 } },
	},
};

export const exercisePropertiesSchema: AppSchema = {
	fields: {
		videos: videosField("Demonstration videos for this exercise"),
		images: imagesField("Cover and demonstration images for this exercise"),
		instructions: {
			type: "array",
			label: "Instructions",
			items: { label: "Item", type: "string", description: "Item" },
			description: "Step-by-step instructions for performing this exercise",
		},
		kind: {
			type: "enum",
			label: "Kind",
			immutable: true,
			validation: { required: true },
			description: "Which measurements are used to track sets of this exercise",
			choices: { kind: "static", values: exerciseKinds.map((value) => ({ value })) },
		},

		force: {
			type: "enum",
			label: "Force",
			description: "Direction of force applied: pull, push, or static hold",
			choices: { kind: "static", values: exerciseForces.map((value) => ({ value })) },
		},

		mechanic: {
			type: "enum",
			label: "Mechanic",
			choices: { kind: "static", values: exerciseMechanics.map((value) => ({ value })) },
			description:
				"Whether the exercise uses multiple joints (compound) or a single joint (isolation)",
		},

		level: {
			type: "enum",
			label: "Level",
			description: "Recommended experience level: beginner, intermediate, or expert",
			choices: { kind: "static", values: exerciseLevels.map((value) => ({ value })) },
		},
	},
};

const workoutSetFields: Record<WorkoutSetField, AppPropertyDefinition> = {
	note: { label: "Note", type: "string", description: "Optional note specific to this set" },
	confirmedAt: {
		type: "datetime",
		label: "Confirmed At",
		description: "Date and time this set was confirmed by the user",
	},
	restTime: {
		type: "integer",
		label: "Rest Time",
		validation: { minimum: 0 },
		description: "Rest time after this set in seconds",
	},
	restTimerStartedAt: {
		type: "datetime",
		label: "Rest Timer Started At",
		description: "Date and time the rest timer was started after this set",
	},
	setOrder: {
		type: "integer",
		label: "Set Order",
		validation: { minimum: 0 },
		description: "Zero-based position of this set within the exercise",
	},
	reps: {
		label: "Reps",
		type: "integer",
		validation: { minimum: 0 },
		description: "Nonnegative whole number of repetitions performed in this set",
	},
	exerciseOrder: {
		type: "integer",
		label: "Exercise Order",
		validation: { minimum: 0 },
		description: "Zero-based position of this exercise within the workout",
	},
	rpe: {
		label: "Rpe",
		type: "integer",
		validation: { minimum: 0, maximum: 10 },
		description: "Rate of perceived exertion from 0 (no effort) to 10 (maximal effort)",
	},
	setLot: {
		type: "enum",
		label: "Set Lot",
		description: "Set type: normal, warm_up, drop, or failure",
		choices: { kind: "static", values: workoutSetLots.map((value) => ({ value })) },
	},
	duration: {
		type: "number",
		label: "Duration",
		validation: { minimum: 0 },
		description: "Duration of this set in seconds",
		normalize: { round: { scale: workoutSetScales.duration } },
	},
	weight: {
		type: "number",
		label: "Weight",
		validation: { minimum: 0 },
		normalize: { round: { scale: workoutSetScales.weight } },
		description: "Weight used in this set in kilograms (kg)",
	},
	oneRm: {
		type: "number",
		label: "One Rm",
		validation: { minimum: 0 },
		normalize: { round: { scale: workoutSetScales.oneRm } },
		description: "One-rep max calculated for this set in kilograms (kg)",
	},
	distance: {
		type: "number",
		label: "Distance",
		validation: { minimum: 0 },
		normalize: { round: { scale: workoutSetScales.distance } },
		description: "Distance covered in this set in kilometers (km)",
	},
	volume: {
		type: "number",
		label: "Volume",
		validation: { minimum: 0 },
		normalize: { round: { scale: workoutSetScales.volume } },
		description: "Volume (kilograms × repetitions) calculated for this set",
	},
	pace: {
		label: "Pace",
		type: "number",
		validation: { minimum: 0 },
		normalize: { round: { scale: workoutSetScales.pace } },
		description: "Speed calculated as kilometers per second from canonical metric measurements",
	},
	exerciseKind: {
		type: "enum",
		label: "Exercise Kind",
		validation: { required: true },
		description: "Exercise kind this set was logged under",
		choices: { kind: "static", values: exerciseKinds.map((value) => ({ value })) },
	},
	personalBests: {
		type: "array",
		label: "Personal Bests",
		validation: { required: true },
		description: "Personal bests achieved in this set",
		items: {
			type: "enum",
			label: "Item",
			description: "Item",
			choices: { kind: "static", values: personalBestTypes.map((value) => ({ value })) },
		},
	},
};

export const workoutSetPropertiesSchema: AppSchema = {
	unknownKeys: "strict",
	fields: Object.fromEntries(
		Object.entries(workoutSetFields).filter(
			([key]) => !workoutSetDerivedFields.some((derived) => derived === key),
		),
	),
};

export const workoutRecordPropertiesSchema: AppSchema = {
	unknownKeys: "strict",
	fields: Object.fromEntries(workoutSetDerivedFields.map((key) => [key, workoutSetFields[key]])),
};

export const workoutPropertiesSchema: AppSchema = {
	fields: {
		images: imagesField("Images attached to this workout"),
		videos: videosField("Videos attached to this workout"),
		endedAt: {
			type: "datetime",
			label: "Ended At",
			description: "Date and time this workout session ended",
		},
		comment: {
			type: "string",
			label: "Comment",
			description: "Optional notes or comments about this workout",
		},
		startedAt: {
			type: "datetime",
			label: "Started At",
			validation: { required: true },
			description: "Date and time this workout session began",
		},
		caloriesBurnt: {
			type: "number",
			label: "Calories Burnt",
			validation: { minimum: 0 },
			description: "Estimated energy burned during this workout in kilocalories (kcal)",
		},
		activeDuration: {
			type: "integer",
			label: "Active Duration",
			validation: { minimum: 0 },
			description: "Recorded workout duration in seconds, including rests but excluding pauses",
		},
		supersets: {
			type: "array",
			label: "Supersets",
			description: "Superset groupings for this workout",
			items: {
				label: "Item",
				type: "object",
				unknownKeys: "strict",
				properties: workoutSupersetItemProperties,
				description: "Superset grouping within a workout or template",
			},
		},
		exerciseMedia: {
			type: "array",
			label: "Exercise Media",
			description: "Images and videos for each exercise occurrence in this workout",
			items: {
				label: "Item",
				type: "object",
				unknownKeys: "strict",
				description: "Media for an exercise occurrence",
				properties: {
					images: imagesField("Images attached to this exercise occurrence in the workout"),
					videos: videosField("Videos attached to this exercise occurrence in the workout"),
					exerciseOrder: {
						type: "integer",
						label: "Exercise Order",
						validation: { minimum: 0, required: true },
						description: "Zero-based position of this exercise within the workout",
					},
				},
			},
		},
		exerciseNotes: {
			type: "array",
			label: "Exercise Notes",
			description: "Notes for each exercise occurrence in this workout",
			items: {
				label: "Item",
				type: "object",
				unknownKeys: "strict",
				description: "Notes for an exercise occurrence",
				properties: {
					exerciseOrder: {
						type: "integer",
						label: "Exercise Order",
						validation: { minimum: 0, required: true },
						description: "Zero-based position of this exercise within the workout",
					},
					notes: {
						type: "array",
						label: "Notes",
						validation: { required: true },
						description: "Notes for this exercise",
						items: { label: "Item", type: "string", description: "Item" },
					},
				},
			},
		},
	},
};

const workoutTemplateSetProperties: Readonly<Record<string, AppPropertyDefinition>> = {
	note: { label: "Note", type: "string", description: "Optional note specific to this set" },
	reps: {
		label: "Reps",
		type: "integer",
		validation: { minimum: 0 },
		description: "Nonnegative whole number of repetitions planned for this set",
	},
	restTime: {
		type: "integer",
		label: "Rest Time",
		validation: { minimum: 0 },
		description: "Planned rest after this set in seconds; zero disables rest",
	},
	setOrder: {
		type: "integer",
		label: "Set Order",
		validation: { minimum: 0, required: true },
		description: "Zero-based position of this set within the exercise",
	},
	rpe: {
		label: "Rpe",
		type: "integer",
		validation: { minimum: 0, maximum: 10 },
		description: "Planned rate of perceived exertion from 0 (no effort) to 10 (maximal effort)",
	},
	weight: {
		type: "number",
		label: "Weight",
		validation: { minimum: 0 },
		normalize: { round: { scale: workoutSetScales.weight } },
		description: "Weight planned for this set in kilograms (kg)",
	},
	duration: {
		type: "number",
		label: "Duration",
		validation: { minimum: 0 },
		description: "Duration planned for this set in seconds",
		normalize: { round: { scale: workoutSetScales.duration } },
	},
	distance: {
		type: "number",
		label: "Distance",
		validation: { minimum: 0 },
		normalize: { round: { scale: workoutSetScales.distance } },
		description: "Distance planned for this set in kilometers (km)",
	},
	setLot: {
		type: "enum",
		label: "Set Lot",
		validation: { required: true },
		description: "Set type: normal, warm_up, drop, or failure",
		choices: { kind: "static", values: workoutSetLots.map((value) => ({ value })) },
	},
};

const workoutTemplateExerciseProperties: Readonly<Record<string, AppPropertyDefinition>> = {
	images: imagesField("Images attached to this exercise in the template"),
	videos: videosField("Videos attached to this exercise in the template"),
	exerciseId: {
		type: "string",
		label: "Exercise Id",
		validation: { required: true },
		description: "Entity id of the exercise",
	},
	exerciseOrder: {
		type: "integer",
		label: "Exercise Order",
		validation: { minimum: 0, required: true },
		description: "Zero-based position of this exercise within the template",
	},
	notes: {
		type: "array",
		label: "Notes",
		validation: { required: true },
		description: "Notes for this exercise",
		items: { label: "Item", type: "string", description: "Item" },
	},
	sets: {
		type: "array",
		label: "Sets",
		validation: { required: true },
		description: "Sets planned for this exercise",
		items: {
			label: "Item",
			type: "object",
			unknownKeys: "strict",
			properties: workoutTemplateSetProperties,
			description: "Set planned in this exercise",
		},
	},
};

export const workoutTemplatePropertiesSchema: AppSchema = {
	fields: {
		images: imagesField("Images attached to this template"),
		videos: videosField("Videos attached to this template"),
		comment: {
			type: "string",
			label: "Comment",
			description: "Optional notes about this workout template",
		},
		exercises: {
			type: "array",
			label: "Exercises",
			description: "Exercises in this template",
			items: {
				label: "Item",
				type: "object",
				unknownKeys: "strict",
				description: "Exercise in this template",
				properties: workoutTemplateExerciseProperties,
			},
		},
		supersets: {
			type: "array",
			label: "Supersets",
			description: "Supersets in this template",
			items: {
				label: "Item",
				type: "object",
				unknownKeys: "strict",
				properties: workoutSupersetItemProperties,
				description: "Superset grouping within a workout or template",
			},
		},
	},
};

export const measurementMetricPropertiesSchema: AppSchema = {
	fields: {
		unit: {
			label: "Unit",
			type: "string",
			description: "Unit readings of this metric are recorded in",
		},
		key: {
			label: "Key",
			type: "string",
			validation: { required: true },
			description: "Stable identifier of this metric within the user's measurements",
		},
	},
};

export const measurementEntryPropertiesSchema: AppSchema = {
	unknownKeys: "strict",
	fields: {
		comment: { type: "string", label: "Comment", description: "Optional notes about this entry" },
		occurredAt: {
			type: "datetime",
			label: "Taken at",
			validation: { required: true },
			description: "Time this measurement entry was recorded",
		},
	},
};

export const measurementReadingPropertiesSchema: AppSchema = {
	unknownKeys: "strict",
	fields: {
		value: {
			type: "number",
			label: "Value",
			validation: { required: true },
			description: "Recorded value of the metric",
		},
	},
};
