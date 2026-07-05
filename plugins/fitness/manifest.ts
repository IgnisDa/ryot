import { definePlugin } from "@ryot/plugin-kit/manifest";

import { fitnessSavedViews } from "./saved-views";
import { fitnessEntitySchemas } from "./schemas/entity-schemas";
import { fitnessRelationshipSchemas } from "./schemas/relationship-schemas";
import { fitnessSignalSchemas } from "./schemas/signal-schemas";
import { fitnessScripts } from "./script-catalog";

export const fitnessPlugin = definePlugin({
	crons: [],
	operations: [],
	scripts: fitnessScripts,
	savedViews: fitnessSavedViews(),
	entitySchemas: fitnessEntitySchemas(),
	signalSchemas: fitnessSignalSchemas(),
	relationshipSchemas: fitnessRelationshipSchemas(),
	boot: [
		{
			slug: "preload-exercises",
			driverRef: "exercise.free-exercise-db",
			description: "Preload the built-in exercise catalog",
		},
	],
	metadata: {
		name: "Fitness",
		slug: "fitness",
		version: "1.0.0",
		icon: "heart-pulse",
		accentColor: "#2DD4BF",
		description: "Track workouts, measurements, and progress.",
	},
	bindings: {
		eventAutomations: [],
		signalAutomations: [],
		relationshipAutomations: [],
		schemaScriptLinks: [{ entitySchemaSlug: "exercise", scriptSlug: "exercise.free-exercise-db" }],
		entityAutomations: [
			{
				operation: "create",
				entitySchemaSlug: "workout",
				scriptSlug: "automation.workout-created",
			},
		],
	},
});

export default fitnessPlugin;
