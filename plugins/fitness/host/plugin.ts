import { definePlugin } from "@ryot-app/contract/modules/plugins/manifest";

import { fitnessConfigSchema } from "./config";
import { fitnessSavedViews } from "./saved-views";
import { fitnessEntitySchemas } from "./schemas/entity";
import { fitnessRelationshipSchemas } from "./schemas/relationship";
import { fitnessSignalSchemas } from "./schemas/signal";

const importDocs = (page: string) => ({ docsUrl: `https://docs.ryot.io/importing/${page}.html` });

const uploadInputSchema = (label: string, description: string) => ({
	unknownKeys: "strict" as const,
	fields: {
		uploadToken: {
			label,
			position: 0,
			description,
			type: "string" as const,
			format: { kind: "upload" as const, allowedFileExtensions: ["csv"] },
			validation: { minLength: 1 as const, required: true as const },
		},
	},
});

export const fitnessPlugin = definePlugin({
	crons: [],
	operations: [],
	userBootstrap: [],
	httpRateLimits: [],
	integrationProviders: [],
	savedViews: fitnessSavedViews(),
	configSchema: fitnessConfigSchema,
	entitySchemas: fitnessEntitySchemas(),
	signalSchemas: fitnessSignalSchemas(),
	relationshipSchemas: fitnessRelationshipSchemas(),
	workflows: [{ slug: "import", scriptSlug: "workflow.import" }],
	boot: [
		{
			slug: "preload-exercises",
			scriptSlug: "exercise.free-exercise-db.preload",
			description: "Preload the built-in exercise catalog",
		},
	],
	client: {
		apiVersion: 1,
		homeView: null,
		entities: {
			workout: { listPresentation: "workout-row", gridPresentation: "workout-card" },
			exercise: { listPresentation: "entity-row", gridPresentation: "entity-card" },
			measurement: { listPresentation: "entity-row", gridPresentation: "entity-card" },
			"workout-template": { listPresentation: "entity-row", gridPresentation: "entity-card" },
		},
		exports: {
			"workout-card": {
				kind: "presentation",
				entry: "client/workout-card.ts",
				automaticEntityPresentations: false,
			},
			"workout-row": {
				kind: "presentation",
				entry: "client/workout-row.ts",
				automaticEntityPresentations: false,
			},
			"entity-card": {
				kind: "presentation",
				entry: "client/entity-card.ts",
				automaticEntityPresentations: false,
			},
			"entity-row": {
				kind: "presentation",
				entry: "client/entity-row.ts",
				automaticEntityPresentations: false,
			},
		},
	},
	providers: [
		{
			name: "Free Exercise DB",
			rootEntitySchemaSlug: "exercise",
			slug: "exercise.free-exercise-db",
			information: { source: "free-exercise-db" },
			operations: {
				search: "exercise.free-exercise-db.search",
				details: "exercise.free-exercise-db.details",
			},
		},
	],
	metadata: {
		name: "Fitness",
		slug: "fitness",
		version: "1.0.0",
		icon: "heart-pulse",
		description: "Track workouts, measurements, and progress.",
	},
	bindings: {
		eventAutomations: [],
		signalAutomations: [],
		relationshipAutomations: [],
		providerEntityImportAutomations: [],
		entityAutomations: [
			{
				operation: "create",
				entitySchemaSlug: "workout",
				scriptSlug: "automation.workout-created",
			},
		],
	},
	importSources: [
		{
			slug: "hevy",
			name: "Hevy",
			workflowSlug: "import",
			requiredPluginConfigKeys: [],
			exportHelp: importDocs("hevy"),
			description: "Import workouts from a Hevy CSV export",
			inputSchema: uploadInputSchema("Hevy export", "Hevy workout export CSV"),
		},
		{
			slug: "strong_app",
			name: "Strong App",
			workflowSlug: "import",
			requiredPluginConfigKeys: [],
			exportHelp: importDocs("strong-app"),
			description: "Import workouts from a Strong CSV export",
			inputSchema: uploadInputSchema("Strong App export", "Strong App workout export CSV"),
		},
		{
			name: "OpenScale",
			slug: "open_scale",
			workflowSlug: "import",
			requiredPluginConfigKeys: [],
			exportHelp: importDocs("open-scale"),
			description: "Import measurements from an OpenScale CSV export",
			inputSchema: uploadInputSchema("OpenScale export", "OpenScale measurements export CSV"),
		},
	],
});

export default fitnessPlugin;
