import { imagesField, videosField } from "@ryot-app/contract/schema/core";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";

import { exerciseKinds } from "../../shared/exercise-kinds";

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
			description: "Which measurements are used to track sets of this exercise",
			choices: { kind: "static", values: exerciseKinds.map((value) => ({ value })) },
		},
		force: {
			type: "enum",
			label: "Force",
			description: "Direction of force applied: pull, push, or static hold",
			choices: {
				kind: "static",
				values: [{ value: "pull" }, { value: "push" }, { value: "static" }],
			},
		},
		mechanic: {
			type: "enum",
			label: "Mechanic",
			choices: { kind: "static", values: [{ value: "compound" }, { value: "isolation" }] },
			description:
				"Whether the exercise uses multiple joints (compound) or a single joint (isolation)",
		},
		level: {
			type: "enum",
			label: "Level",
			description: "Recommended experience level: beginner, intermediate, or expert",
			choices: {
				kind: "static",
				values: [{ value: "beginner" }, { value: "intermediate" }, { value: "expert" }],
			},
		},
	},
};

export const workoutSetPropertiesSchema: AppSchema = {
	fields: {
		images: imagesField("Images attached to this exercise in the workout"),
		videos: videosField("Videos attached to this exercise in the workout"),
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
		weight: {
			type: "number",
			label: "Weight",
			validation: { minimum: 0 },
			description: "Weight used in this set in kilograms (kg)",
		},
		distance: {
			type: "number",
			label: "Distance",
			validation: { minimum: 0 },
			description: "Distance covered in this set in kilometers (km)",
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
		duration: {
			type: "number",
			label: "Duration",
			validation: { minimum: 0 },
			normalize: { round: { scale: 3 } },
			description: "Duration of this set in seconds",
		},
		rpe: {
			label: "Rpe",
			type: "integer",
			validation: { minimum: 0, maximum: 10 },
			description: "Rate of perceived exertion from 0 (no effort) to 10 (maximal effort)",
		},
		oneRm: {
			type: "number",
			label: "One Rm",
			validation: { minimum: 0 },
			normalize: { round: { scale: 6 } },
			description: "One-rep max calculated for this set in kilograms (kg)",
		},
		volume: {
			type: "number",
			label: "Volume",
			validation: { minimum: 0 },
			normalize: { round: { scale: 6 } },
			description: "Volume (kilograms × repetitions) calculated for this set",
		},
		pace: {
			label: "Pace",
			type: "number",
			validation: { minimum: 0 },
			normalize: { round: { scale: 12 } },
			description: "Speed calculated as kilometers per second from canonical metric measurements",
		},
		unitSystem: {
			type: "enum",
			label: "Unit System",
			choices: { kind: "static", values: [{ value: "metric" }, { value: "imperial" }] },
			description:
				"Source input unit system; stored measurements and calculations use canonical metric units (kg, km, seconds)",
		},
		setLot: {
			type: "enum",
			label: "Set Lot",
			description: "Set type: normal, warm_up, drop, or failure",
			choices: {
				kind: "static",
				values: [
					{ value: "normal" },
					{ value: "warm_up" },
					{ value: "drop" },
					{ value: "failure" },
				],
			},
		},
		personalBests: {
			type: "array",
			label: "Personal Bests",
			description: "Personal bests achieved in this set",
			items: {
				type: "enum",
				label: "Item",
				description: "Item",
				choices: {
					kind: "static",
					values: [
						{ value: "time" },
						{ value: "pace" },
						{ value: "reps" },
						{ value: "one_rm" },
						{ value: "volume" },
						{ value: "weight" },
						{ value: "distance" },
					],
				},
			},
		},
	},
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
			description: "Date and time this workout session began",
		},
		caloriesBurnt: {
			type: "number",
			label: "Calories Burnt",
			description: "Estimated calories burned during this workout",
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
	setOrder: {
		type: "integer",
		label: "Set Order",
		validation: { minimum: 0, required: true },
		description: "Zero-based position of this set within the exercise",
	},
	duration: {
		type: "number",
		label: "Duration",
		validation: { minimum: 0 },
		normalize: { round: { scale: 3 } },
		description: "Duration planned for this set in seconds",
	},
	weight: {
		type: "number",
		label: "Weight",
		validation: { minimum: 0 },
		normalize: { round: { scale: 6 } },
		description: "Weight planned for this set in kilograms (kg)",
	},
	rpe: {
		label: "Rpe",
		type: "integer",
		validation: { minimum: 0, maximum: 10 },
		description: "Planned rate of perceived exertion from 0 (no effort) to 10 (maximal effort)",
	},
	distance: {
		type: "number",
		label: "Distance",
		validation: { minimum: 0 },
		normalize: { round: { scale: 9 } },
		description: "Distance planned for this set in kilometers (km)",
	},
	setLot: {
		type: "enum",
		label: "Set Lot",
		validation: { required: true },
		description: "Set type: normal, warm_up, drop, or failure",
		choices: {
			kind: "static",
			values: [{ value: "normal" }, { value: "warm_up" }, { value: "drop" }, { value: "failure" }],
		},
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

export const measurementPropertiesSchema: AppSchema = {
	fields: {
		comment: {
			type: "string",
			label: "Comment",
			description: "Optional notes about this measurement",
		},
		recordedAt: {
			type: "datetime",
			label: "Recorded At",
			description: "Date and time this measurement was recorded",
		},
		statistics: {
			type: "array",
			label: "Statistics",
			description: "Array of measurement statistics",
			items: {
				label: "Item",
				type: "object",
				description: "Item",
				properties: {
					key: { label: "Key", type: "string", description: "Key", validation: { required: true } },
					value: {
						type: "number",
						label: "Value",
						description: "Value",
						validation: { required: true },
					},
					label: {
						type: "string",
						label: "Label",
						description: "Label",
						validation: { required: true },
					},
				},
			},
		},
	},
};
