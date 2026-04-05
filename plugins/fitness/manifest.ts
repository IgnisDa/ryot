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
	providers: [
		{
			name: "Free Exercise DB",
			slug: "exercise.free-exercise-db",
			information: { source: "free-exercise-db" },
			operations: {
				search: "exercise.free-exercise-db.search",
				details: "exercise.free-exercise-db.details",
			},
		},
	],
	savedViews: fitnessSavedViews(),
	entitySchemas: fitnessEntitySchemas(),
	signalSchemas: fitnessSignalSchemas(),
	relationshipSchemas: fitnessRelationshipSchemas(),
	boot: [
		{
			slug: "preload-exercises",
			scriptSlug: "exercise.free-exercise-db.preload",
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
		schemaProviderLinks: [
			{ entitySchemaSlug: "exercise", providerSlug: "exercise.free-exercise-db" },
		],
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
