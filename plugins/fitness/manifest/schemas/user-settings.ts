import type { AppSchema } from "@ryot-app/contract/schema/property-schema";

import { energyUnits, unitSystems } from "../../shared/workout-units";

export const fitnessUserSettingsSchema: AppSchema = {
	unknownKeys: "strict",
	fields: {
		muteSounds: {
			position: 5,
			type: "boolean",
			defaultValue: false,
			label: "Mute sounds",
			validation: { required: true },
			description: "Mute workout action and timer sounds",
		},
		weeklyWorkoutGoal: {
			position: 9,
			type: "integer",
			label: "Weekly workout goal",
			validation: { minimum: 1, maximum: 14 },
			description: "Workouts you aim to complete each week; Home tracks progress",
		},
		dropRestTime: {
			position: 3,
			type: "integer",
			defaultValue: 0,
			label: "Drop set rest",
			validation: { minimum: 0, required: true },
			description: "Default drop set rest in seconds; zero disables rest",
		},
		normalRestTime: {
			position: 1,
			type: "integer",
			defaultValue: 60,
			label: "Normal set rest",
			validation: { minimum: 0, required: true },
			description: "Default normal set rest in seconds; zero disables rest",
		},
		warmUpRestTime: {
			position: 2,
			type: "integer",
			defaultValue: 0,
			label: "Warm-up set rest",
			validation: { minimum: 0, required: true },
			description: "Default warm-up set rest in seconds; zero disables rest",
		},
		failureRestTime: {
			position: 4,
			type: "integer",
			defaultValue: 0,
			label: "Failure set rest",
			validation: { minimum: 0, required: true },
			description: "Default failure set rest in seconds; zero disables rest",
		},
		promptForRestTimer: {
			position: 6,
			type: "boolean",
			defaultValue: false,
			label: "Prompt for rest timer",
			validation: { required: true },
			description: "Ask before starting a rest timer when a set is confirmed",
		},
		startTimerForDurationExercises: {
			position: 7,
			type: "boolean",
			defaultValue: true,
			validation: { required: true },
			label: "Use duration countdowns",
			description: "Offer a countdown when a duration-based set has a planned duration",
		},
		energyUnit: {
			position: 8,
			type: "enum",
			defaultValue: "kcal",
			label: "Energy unit",
			validation: { required: true },
			description: "Display energy in kcal or kJ; recorded energy stays in kcal",
			choices: { kind: "static", values: energyUnits.map((value) => ({ value })) },
		},
		unitSystem: {
			position: 0,
			type: "enum",
			defaultValue: "metric",
			label: "Display units",
			validation: { required: true },
			choices: { kind: "static", values: unitSystems.map((value) => ({ value })) },
			description:
				"Display weights and distances in metric or imperial units; storage stays metric",
		},
	},
};
