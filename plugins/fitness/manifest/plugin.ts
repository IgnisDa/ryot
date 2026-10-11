import { CLIENT_API_VERSION, definePlugin } from "@ryot-app/contract/modules/plugins/manifest";

import { exerciseNoteOperationSlugs } from "../shared/exercise-note-operations";
import {
	measurementMetricCreateOperationSlug,
	measurementMetricPinOperationSlug,
} from "../shared/measurement-metric-operations";
import {
	measurementReadingDeleteOperationSlug,
	measurementReadingLogOperationSlug,
	measurementReadingUpdateOperationSlug,
} from "../shared/measurement-reading-operations";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import {
	exerciseOverrideUpdateOperationSlug,
	workoutEditorContextOperationSlug,
	workoutEditorSaveOperationSlug,
	workoutTimeCorrectionOperationSlug,
} from "../shared/workout-editor-context-operations";
import { fitnessConfigSchema } from "./config";
import { fitnessSavedViews } from "./saved-views";
import { fitnessEntitySchemas } from "./schemas/entity";
import { fitnessRelationshipSchemas } from "./schemas/relationship";
import { fitnessSignalSchemas } from "./schemas/signal";
import { fitnessUserSettingsSchema } from "./schemas/user-settings";

const importDocs = (page: string) => ({ docsUrl: `https://docs.ryot.io/importing/${page}.html` });

const uploadInputSchema = (label: string, description: string) => ({
	unknownKeys: "strict" as const,
	fields: {
		uploadToken: {
			label,
			position: 0,
			description,
			type: "string" as const,
			validation: { minLength: 1 as const, required: true as const },
			format: { kind: "upload" as const, allowedFileExtensions: ["csv"] },
		},
	},
});

const timezoneInputField = {
	position: 1,
	label: "Timezone",
	type: "string" as const,
	format: { kind: "timezone" as const },
	validation: { required: true as const },
	description: "Timezone the export's dates were recorded in",
};

const timezoneUploadInputSchema = (...args: Parameters<typeof uploadInputSchema>) => {
	const base = uploadInputSchema(...args);
	return { ...base, fields: { ...base.fields, timezone: timezoneInputField } };
};

export const fitnessPlugin = definePlugin({
	crons: [],
	httpRateLimits: [],
	integrationProviders: [],
	savedViews: fitnessSavedViews(),
	configSchema: fitnessConfigSchema,
	entitySchemas: fitnessEntitySchemas,
	signalSchemas: fitnessSignalSchemas(),
	userSettingsSchema: fitnessUserSettingsSchema,
	relationshipSchemas: fitnessRelationshipSchemas(),
	userBootstrap: [
		{
			slug: "initialize-workspace",
			scriptSlug: "bootstrap.fitness-workspace",
			description: "Initialize the user's fitness workspace",
		},
	],
	metadata: {
		name: "Fitness",
		version: "1.0.0",
		icon: "heart-pulse",
		packageId: PLUGIN_PACKAGE_ID,
		description: "Track workouts, measurements, and progress.",
	},
	workflows: [
		{ slug: "import", scriptSlug: "workflow.import" },
		{ slug: "import-application", scriptSlug: "workflow.import-application" },
		{ slug: "import-merge", scriptSlug: "workflow.import-merge" },
	],
	providers: [
		{
			name: "Free Exercise DB",
			rootEntitySchemaSlug: "exercise",
			slug: "exercise.free-exercise-db",
			information: { source: "free-exercise-db" },
			operations: {
				search: "exercise.free-exercise-db.search",
				details: "exercise.free-exercise-db.details",
				resolve: "exercise.free-exercise-db.resolve",
			},
		},
		{
			name: "Exercise Target Fitness Catalog",
			rootEntitySchemaSlug: "exercise-target",
			slug: "exercise-target.fitness-catalog",
			information: { source: "fitness-catalog" },
			operations: {
				search: "exercise-target.fitness-catalog.search",
				details: "exercise-target.fitness-catalog.details",
				resolve: "exercise-target.fitness-catalog.resolve",
			},
		},
		{
			name: "Exercise Equipment Fitness Catalog",
			rootEntitySchemaSlug: "exercise-equipment",
			slug: "exercise-equipment.fitness-catalog",
			information: { source: "fitness-catalog" },
			operations: {
				search: "exercise-equipment.fitness-catalog.search",
				details: "exercise-equipment.fitness-catalog.details",
				resolve: "exercise-equipment.fitness-catalog.resolve",
			},
		},
	],
	importSources: (
		[
			{
				slug: "hevy",
				name: "Hevy",
				workflowSlug: "import",
				exportHelp: importDocs("hevy"),
				description: "Import workouts from a Hevy CSV export",
				inputSchema: timezoneUploadInputSchema("Hevy export", "Hevy workout export CSV"),
			},
			{
				slug: "strong_app",
				name: "Strong App",
				workflowSlug: "import",
				exportHelp: importDocs("strong-app"),
				description: "Import workouts from a Strong CSV export",
				inputSchema: timezoneUploadInputSchema(
					"Strong App export",
					"Strong App workout export CSV",
				),
			},
			{
				name: "OpenScale",
				slug: "open_scale",
				workflowSlug: "import",
				exportHelp: importDocs("open-scale"),
				description: "Import measurements from an OpenScale CSV export",
				inputSchema: uploadInputSchema("OpenScale export", "OpenScale measurements export CSV"),
			},
		] as const
	).map((source) =>
		Object.assign({}, source, {
			plan: {
				selections: {
					"source-parser": {
						value: {
							hevy: "import.hevy",
							strong_app: "import.strong-app",
							open_scale: "import.open-scale",
						}[source.slug],
					},
				},
			},
		}),
	),
	client: {
		homeView: null,
		apiVersion: CLIENT_API_VERSION,
		entities: {
			"workout-template": { listPresentation: "entity-row", gridPresentation: "entity-card" },
			"measurement-metric": { listPresentation: "entity-row", gridPresentation: "entity-card" },
			exercise: {
				detailPage: "exercise-detail",
				listPresentation: "entity-row",
				gridPresentation: "entity-card",
			},
			workout: {
				detailPage: "workout-detail",
				listPresentation: "workout-row",
				gridPresentation: "workout-card",
			},
		},
		exports: {
			"entity-row": {
				kind: "presentation",
				entry: "client/entity-row.ts",
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
			"workout-card": {
				kind: "presentation",
				entry: "client/workout-card.ts",
				automaticEntityPresentations: false,
			},
			"workout-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/workout/screen.tsx",
				automaticEntityPresentations: false,
			},
			measurements: {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/measurements/screen.tsx",
			},
			"exercise-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/exercise/screen.tsx",
				automaticEntityPresentations: false,
			},
		},
	},
	operations: [
		{
			auth: "user",
			demoAccess: "protected",
			slug: workoutEditorSaveOperationSlug,
			description: "Save a workout or template",
			scriptSlug: "operation.workout-editor-save",
		},
		{
			auth: "user",
			demoAccess: "allowed",
			slug: workoutEditorContextOperationSlug,
			scriptSlug: "operation.workout-editor-context",
			description: "Read workout editor preferences and availability",
		},
		{
			auth: "user",
			demoAccess: "protected",
			slug: exerciseOverrideUpdateOperationSlug,
			description: "Update exercise preferences",
			scriptSlug: "operation.exercise-override-update",
		},
		{
			auth: "user",
			demoAccess: "protected",
			description: "Correct workout times",
			slug: workoutTimeCorrectionOperationSlug,
			scriptSlug: "operation.workout-time-correction",
		},
		{
			auth: "user",
			demoAccess: "protected",
			slug: measurementMetricCreateOperationSlug,
			description: "Create a measurement metric",
			scriptSlug: "operation.measurement-metric-create",
		},
		{
			auth: "user",
			demoAccess: "protected",
			slug: measurementMetricPinOperationSlug,
			scriptSlug: "operation.measurement-metric-pin",
			description: "Pin or unpin a measurement metric",
		},
		{
			auth: "user",
			demoAccess: "protected",
			description: "Log measurement readings",
			slug: measurementReadingLogOperationSlug,
			scriptSlug: "operation.measurement-reading-log",
		},
		{
			auth: "user",
			demoAccess: "protected",
			description: "Update measurement readings",
			slug: measurementReadingUpdateOperationSlug,
			scriptSlug: "operation.measurement-reading-update",
		},
		{
			auth: "user",
			demoAccess: "protected",
			description: "Delete measurement readings",
			slug: measurementReadingDeleteOperationSlug,
			scriptSlug: "operation.measurement-reading-delete",
		},
		{
			auth: "user",
			demoAccess: "protected",
			slug: exerciseNoteOperationSlugs.create,
			scriptSlug: "operation.exercise-note-create",
			description: "Create a private exercise note",
		},
		{
			auth: "user",
			demoAccess: "protected",
			slug: exerciseNoteOperationSlugs.update,
			scriptSlug: "operation.exercise-note-update",
			description: "Update a private exercise note",
		},
		{
			auth: "user",
			demoAccess: "protected",
			slug: exerciseNoteOperationSlugs.delete,
			scriptSlug: "operation.exercise-note-delete",
			description: "Delete a private exercise note",
		},
	],
	hooks: [
		{
			position: 100,
			stage: "before",
			slug: "fitness.workout-context",
			name: "Require workout set context",
			scriptSlug: "policy.workout-context",
			targets: [
				{
					resource: "event",
					operation: "create",
					entitySchemaSlug: "exercise",
					eventSchemaSlug: "workout-set",
				},
				{
					resource: "event",
					operation: "update",
					entitySchemaSlug: "exercise",
					eventSchemaSlug: "workout-set",
				},
			],
		},
		{
			position: 110,
			stage: "before",
			slug: "fitness.workout-set",
			name: "Normalize workout sets",
			scriptSlug: "policy.workout-set",
			targets: [
				{
					resource: "event",
					operation: "create",
					entitySchemaSlug: "exercise",
					eventSchemaSlug: "workout-set",
				},
				{
					resource: "event",
					operation: "update",
					entitySchemaSlug: "exercise",
					eventSchemaSlug: "workout-set",
				},
			],
		},
		{
			stage: "after",
			batchMaxItems: 50,
			delivery: "async",
			frequency: "batch",
			executionScope: "user",
			slug: "fitness.workout-records",
			name: "Recompute workout records",
			scriptSlug: "automation.workout-records",
			targets: (["create", "update", "delete"] as const).map((operation) => ({
				operation,
				resource: "event" as const,
				entitySchemaSlug: "exercise",
				eventSchemaSlug: "workout-set",
			})),
		},
		{
			stage: "after",
			delivery: "async",
			executionScope: "user",
			slug: "fitness.workout-context-records",
			scriptSlug: "automation.workout-records",
			name: "Recompute records after workout start changes",
			targets: [{ resource: "entity", operation: "update", entitySchemaSlug: "workout" }],
		},
		{
			stage: "after",
			delivery: "required",
			executionScope: "user",
			name: "Ensure fitness library membership",
			slug: "fitness.ensure-fitness-library-membership",
			scriptSlug: "automation.ensure-fitness-library-membership",
			targets: [
				{ resource: "entity", operation: "create", entitySchemaSlug: "exercise" },
				{ operation: "complete", entitySchemaSlug: "exercise", resource: "provider-entity-import" },
			],
		},
		{
			stage: "after",
			delivery: "async",
			name: "Workout created",
			causationSources: ["api"],
			slug: "fitness.workout-created",
			scriptSlug: "automation.workout-created",
			targets: [
				{
					resource: "event",
					operation: "create",
					entitySchemaSlug: "workout",
					eventSchemaSlug: "workout-completed",
				},
			],
		},
		{
			stage: "after",
			delivery: "async",
			slug: "fitness.notification",
			name: "Fitness notification",
			scriptSlug: "automation.fitness-notification",
			targets: [{ operation: "emit", resource: "signal", signalSchemaSlug: "workout.created" }],
			retry: {
				maxAttempts: 1,
				maxDelayMs: 60000,
				initialDelayMs: 1000,
				externalIdempotency: "none",
			},
		},
	],
});

export default fitnessPlugin;
