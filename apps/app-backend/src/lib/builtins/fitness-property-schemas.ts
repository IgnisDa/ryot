import type { AppSchema } from "~/lib/schema";

const entityAssetsProperties = {
	s3Images: {
		type: "array",
		label: "S3 Images",
		description: "S3 image keys",
		validation: { required: true },
		items: { type: "string", label: "Item", description: "Item" },
	},
	s3Videos: {
		type: "array",
		label: "S3 Videos",
		description: "S3 video keys",
		validation: { required: true },
		items: { type: "string", label: "Item", description: "Item" },
	},
	remoteImages: {
		type: "array",
		label: "Remote Images",
		validation: { required: true },
		description: "Remote image URLs",
		items: { type: "string", label: "Item", description: "Item" },
	},
	remoteVideos: {
		type: "array",
		label: "Remote Videos",
		validation: { required: true },
		description: "Remote hosted videos",
		items: {
			label: "Item",
			type: "object",
			description: "Item",
			unknownKeys: "strict",
			properties: {
				url: { type: "string", label: "Url", description: "Url", validation: { required: true } },
				source: {
					type: "enum",
					label: "Source",
					description: "Source",
					validation: { required: true },
					options: ["youtube", "dailymotion"],
				},
			},
		},
	},
};

const workoutSupersetItemProperties = {
	color: { type: "string", label: "Color", description: "Color", validation: { required: true } },
	exercises: {
		type: "array",
		label: "Exercises",
		description: "Exercises",
		validation: { required: true },
		items: { type: "integer", label: "Item", description: "Item", validation: { minimum: 0 } },
	},
};

export const exercisePropertiesSchema: AppSchema = {
	fields: {
		images: {
			type: "array",
			label: "Images",
			description: "Cover and demonstration images for this exercise",
			items: {
				label: "Item",
				type: "object",
				description: "Item",
				unknownKeys: "strict",
				properties: {
					key: { type: "string", label: "Key", description: "Key" },
					url: { type: "string", label: "Url", description: "Url" },
					type: {
						type: "enum",
						label: "Type",
						description: "Type",
						options: ["s3", "remote"],
						validation: { required: true },
					},
				},
			},
		},
		muscles: {
			label: "Muscles",
			type: "enum-array",
			description: "Primary and secondary muscle groups targeted by this exercise",
			options: [
				"lats",
				"neck",
				"traps",
				"chest",
				"biceps",
				"calves",
				"glutes",
				"triceps",
				"forearms",
				"abductors",
				"adductors",
				"shoulders",
				"lower_back",
				"abdominals",
				"hamstrings",
				"quadriceps",
				"middle_back",
			],
			validation: { required: true },
		},
		instructions: {
			type: "array",
			label: "Instructions",
			items: { type: "string", label: "Item", description: "Item" },
			description: "Step-by-step instructions for performing this exercise",
		},
		force: {
			type: "enum",
			label: "Force",
			options: ["pull", "push", "static"],
			description: "Direction of force applied: pull, push, or static hold",
		},
		level: {
			type: "enum",
			label: "Level",
			options: ["beginner", "intermediate", "expert"],
			description: "Recommended experience level: beginner, intermediate, or expert",
		},
		mechanic: {
			type: "enum",
			label: "Mechanic",
			options: ["compound", "isolation"],
			description:
				"Whether the exercise uses multiple joints (compound) or a single joint (isolation)",
		},
		kind: {
			type: "enum",
			label: "Kind",
			description: "Which measurements are used to track sets of this exercise",
			options: [
				"reps",
				"duration",
				"reps_and_weight",
				"reps_and_duration",
				"distance_and_duration",
				"reps_and_duration_and_distance",
			],
		},
		equipment: {
			type: "enum",
			label: "Equipment",
			description: "Equipment required to perform this exercise",
			options: [
				"bands",
				"cable",
				"other",
				"barbell",
				"machine",
				"body_only",
				"dumbbell",
				"foam_roll",
				"ez_curl_bar",
				"kettlebells",
				"exercise_ball",
				"medicine_ball",
			],
		},
	},
};

export const workoutSetPropertiesSchema: AppSchema = {
	fields: {
		pace: { type: "number", label: "Pace", description: "Pace calculated for this set" },
		note: { type: "string", label: "Note", description: "Optional note specific to this set" },
		duration: {
			type: "number",
			label: "Duration",
			description: "Duration of this set in seconds",
		},
		oneRm: { type: "number", label: "One Rm", description: "One-rep max calculated for this set" },
		reps: {
			type: "number",
			label: "Reps",
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
			type: "integer",
			label: "Rpe",
			validation: { minimum: 0, maximum: 10 },
			description: "Rate of perceived exertion from 0 (no effort) to 10 (maximal effort)",
		},
		setLot: {
			type: "enum",
			label: "Set Lot",
			options: ["normal", "warm_up", "drop", "failure"],
			description: "Set type: normal, warm_up, drop, or failure",
		},
		unitSystem: {
			type: "enum",
			label: "Unit System",
			options: ["metric", "imperial"],
			description: "Unit system used for this exercise in the workout",
		},
		personalBests: {
			type: "array",
			label: "Personal Bests",
			description: "Personal bests achieved in this set",
			items: {
				type: "enum",
				label: "Item",
				description: "Item",
				options: ["time", "pace", "reps", "one_rm", "volume", "weight", "distance"],
			},
		},
		exerciseAssets: {
			type: "object",
			unknownKeys: "strict",
			label: "Exercise Assets",
			properties: entityAssetsProperties,
			description: "Media assets attached to this exercise in the workout",
		},
		restTimerStartedAt: {
			type: "datetime",
			label: "Rest Timer Started At",
			description: "Date and time the rest timer was started after this set",
		},
	},
};

export const workoutPropertiesSchema: AppSchema = {
	fields: {
		startedAt: {
			type: "datetime",
			label: "Started At",
			description: "Date and time this workout session began",
		},
		assets: {
			type: "object",
			label: "Assets",
			unknownKeys: "strict",
			properties: entityAssetsProperties,
			description: "Media assets attached to this workout",
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
				type: "object",
				label: "Item",
				unknownKeys: "strict",
				properties: workoutSupersetItemProperties,
				description: "Superset grouping within a workout or template",
			},
		},
	},
};

const workoutTemplateSetProperties = {
	note: { type: "string", label: "Note", description: "Note" },
	reps: { type: "number", label: "Reps", description: "Reps" },
	duration: { type: "number", label: "Duration", description: "Duration" },
	weight: { type: "number", label: "Weight", description: "Weight" },
	distance: { type: "number", label: "Distance", description: "Distance" },
	setOrder: {
		type: "integer",
		label: "Set Order",
		description: "Set Order",
		validation: { minimum: 0, required: true },
	},
	setLot: {
		type: "enum",
		label: "Set Lot",
		description: "Set Lot",
		validation: { required: true },
		options: ["normal", "warm_up", "drop", "failure"],
	},
	rpe: {
		label: "Rpe",
		type: "integer",
		description: "Rpe",
		validation: { minimum: 0, maximum: 10 },
	},
};

const workoutTemplateExerciseProperties = {
	exerciseId: {
		type: "string",
		label: "Exercise Id",
		description: "Exercise Id",
		validation: { required: true },
	},
	notes: {
		type: "array",
		label: "Notes",
		description: "Notes",
		validation: { required: true },
		items: { type: "string", label: "Item", description: "Item" },
	},
	sets: {
		type: "array",
		label: "Sets",
		description: "Sets",
		items: {
			label: "Item",
			type: "object",
			unknownKeys: "strict",
			properties: workoutTemplateSetProperties,
			description: "Set planned in this exercise",
		},
		validation: { required: true },
	},
	exerciseOrder: {
		type: "integer",
		label: "Exercise Order",
		description: "Exercise Order",
		validation: { minimum: 0, required: true },
	},
};

export const workoutTemplatePropertiesSchema: AppSchema = {
	fields: {
		comment: {
			type: "string",
			label: "Comment",
			description: "Optional notes about this workout template",
		},
		assets: {
			type: "object",
			label: "Assets",
			unknownKeys: "strict",
			properties: entityAssetsProperties,
			description: "Media assets attached to this template",
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
				type: "object",
				label: "Item",
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
						type: "string",
						label: "Key",
						description: "Key",
						validation: { required: true },
					},
				},
			},
		},
	},
};
