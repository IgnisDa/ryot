import { imagesField, videosField } from "@ryot-app/contract/schema/core";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";

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
		items: { type: "integer", label: "Item", description: "Item", validation: { minimum: 0 } },
	},
};

export const exercisePropertiesSchema: AppSchema = {
	fields: {
		videos: videosField("Demonstration videos for this exercise"),
		images: imagesField("Cover and demonstration images for this exercise"),
		instructions: {
			type: "array",
			label: "Instructions",
			items: { type: "string", label: "Item", description: "Item" },
			description: "Step-by-step instructions for performing this exercise",
		},
		force: {
			type: "enum",
			label: "Force",
			choices: {
				kind: "static",
				values: [{ value: "pull" }, { value: "push" }, { value: "static" }],
			},
			description: "Direction of force applied: pull, push, or static hold",
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
		mechanic: {
			type: "enum",
			label: "Mechanic",
			choices: { kind: "static", values: [{ value: "compound" }, { value: "isolation" }] },
			description:
				"Whether the exercise uses multiple joints (compound) or a single joint (isolation)",
		},
		kind: {
			type: "enum",
			label: "Kind",
			description: "Which measurements are used to track sets of this exercise",
			choices: {
				kind: "static",
				values: [
					{ value: "reps" },
					{ value: "duration" },
					{ value: "reps_and_weight" },
					{ value: "reps_and_duration" },
					{ value: "distance_and_duration" },
					{ value: "reps_and_duration_and_distance" },
				],
			},
		},
		equipment: {
			type: "enum",
			label: "Equipment",
			description: "Equipment required to perform this exercise",
			choices: {
				kind: "static",
				values: [
					{ value: "bands" },
					{ value: "cable" },
					{ value: "other" },
					{ value: "barbell" },
					{ value: "machine" },
					{ value: "body_only" },
					{ value: "dumbbell" },
					{ value: "foam_roll" },
					{ value: "ez_curl_bar" },
					{ value: "kettlebells" },
					{ value: "exercise_ball" },
					{ value: "medicine_ball" },
				],
			},
		},
		muscles: {
			label: "Muscles",
			type: "enum-array",
			validation: { required: true },
			description: "Primary and secondary muscle groups targeted by this exercise",
			choices: {
				kind: "static",
				values: [
					{ value: "lats" },
					{ value: "neck" },
					{ value: "traps" },
					{ value: "chest" },
					{ value: "biceps" },
					{ value: "calves" },
					{ value: "glutes" },
					{ value: "triceps" },
					{ value: "forearms" },
					{ value: "abductors" },
					{ value: "adductors" },
					{ value: "shoulders" },
					{ value: "lower_back" },
					{ value: "abdominals" },
					{ value: "hamstrings" },
					{ value: "quadriceps" },
					{ value: "middle_back" },
				],
			},
		},
	},
};

export const workoutSetPropertiesSchema: AppSchema = {
	fields: {
		images: imagesField("Images attached to this exercise in the workout"),
		videos: videosField("Videos attached to this exercise in the workout"),
		pace: { type: "number", label: "Pace", description: "Pace calculated for this set" },
		note: { type: "string", label: "Note", description: "Optional note specific to this set" },
		oneRm: { type: "number", label: "One Rm", description: "One-rep max calculated for this set" },
		duration: { type: "number", label: "Duration", description: "Duration of this set in seconds" },
		reps: {
			label: "Reps",
			type: "number",
			description: "Number of repetitions performed in this set",
		},
		volume: {
			type: "number",
			label: "Volume",
			description: "Volume (weight × reps) calculated for this set",
		},
		weight: {
			type: "number",
			label: "Weight",
			description: "Weight used in this set in the user's preferred unit",
		},
		distance: {
			type: "number",
			label: "Distance",
			description: "Distance covered in this set in the user's preferred unit",
		},
		setOrder: {
			type: "integer",
			label: "Set Order",
			validation: { minimum: 0 },
			description: "Zero-based position of this set within the exercise",
		},
		restTime: {
			type: "integer",
			label: "Rest Time",
			validation: { minimum: 0 },
			description: "Rest time after this set in seconds",
		},
		exerciseOrder: {
			type: "integer",
			label: "Exercise Order",
			validation: { minimum: 0 },
			description: "Zero-based position of this exercise within the workout",
		},
		confirmedAt: {
			type: "datetime",
			label: "Confirmed At",
			description: "Date and time this set was confirmed by the user",
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
			choices: {
				kind: "static",
				values: [
					{ value: "normal" },
					{ value: "warm_up" },
					{ value: "drop" },
					{ value: "failure" },
				],
			},
			description: "Set type: normal, warm_up, drop, or failure",
		},
		unitSystem: {
			type: "enum",
			label: "Unit System",
			description: "Unit system used for this exercise in the workout",
			choices: { kind: "static", values: [{ value: "metric" }, { value: "imperial" }] },
		},
		restTimerStartedAt: {
			type: "datetime",
			label: "Rest Timer Started At",
			description: "Date and time the rest timer was started after this set",
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
		startedAt: {
			type: "datetime",
			label: "Started At",
			description: "Date and time this workout session began",
		},
		comment: {
			type: "string",
			label: "Comment",
			description: "Optional notes or comments about this workout",
		},
		endedAt: {
			type: "datetime",
			label: "Ended At",
			description: "Date and time this workout session ended",
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
	},
};

const workoutTemplateSetProperties: Readonly<Record<string, AppPropertyDefinition>> = {
	note: { label: "Note", type: "string", description: "Optional note specific to this set" },
	reps: {
		label: "Reps",
		type: "number",
		description: "Number of repetitions planned for this set",
	},
	duration: {
		type: "number",
		label: "Duration",
		description: "Duration planned for this set in seconds",
	},
	weight: {
		type: "number",
		label: "Weight",
		description: "Weight planned for this set in the user's preferred unit",
	},
	distance: {
		type: "number",
		label: "Distance",
		description: "Distance planned for this set in the user's preferred unit",
	},
	setOrder: {
		type: "integer",
		label: "Set Order",
		validation: { minimum: 0, required: true },
		description: "Zero-based position of this set within the exercise",
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
	rpe: {
		label: "Rpe",
		type: "integer",
		validation: { minimum: 0, maximum: 10 },
		description: "Planned rate of perceived exertion from 0 (no effort) to 10 (maximal effort)",
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
	notes: {
		type: "array",
		label: "Notes",
		validation: { required: true },
		description: "Notes for this exercise",
		items: { type: "string", label: "Item", description: "Item" },
	},
	exerciseOrder: {
		type: "integer",
		label: "Exercise Order",
		description: "Zero-based position of this exercise within the template",
		validation: { minimum: 0, required: true },
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
				type: "object",
				label: "Item",
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
					key: {
						label: "Key",
						type: "string",
						description: "Key",
						validation: { required: true },
					},
				},
			},
		},
	},
};
