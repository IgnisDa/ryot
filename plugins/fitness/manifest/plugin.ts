import { CLIENT_API_VERSION, definePlugin } from "@ryot-app/contract/modules/plugins/manifest";
import { operationJsonSchema } from "@ryot-app/plugin-kit/operations";

import {
	ExerciseMergeInputSchema,
	exerciseMergeOperationSlug,
	ExerciseMergeOutputSchema,
} from "../shared/exercise-merge-operations";
import {
	ExerciseNoteCreateInput,
	ExerciseNoteDeleteInput,
	exerciseNoteOperationSlugs,
	ExerciseNoteOutput,
	ExerciseNoteUpdateInput,
} from "../shared/exercise-note-operations";
import {
	MeasurementMetricCreateInput,
	measurementMetricCreateOperationSlug,
	MeasurementMetricCreateOutput,
	MeasurementMetricPinInput,
	measurementMetricPinOperationSlug,
	MeasurementMetricPinOutput,
} from "../shared/measurement-metric-operations";
import {
	MeasurementReadingDeleteInput,
	measurementReadingDeleteOperationSlug,
	MeasurementReadingLogInput,
	measurementReadingLogOperationSlug,
	MeasurementReadingLogOutput,
	MeasurementReadingOutput,
	MeasurementReadingUpdateInput,
	measurementReadingUpdateOperationSlug,
} from "../shared/measurement-reading-operations";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import {
	WorkoutDeleteInputSchema,
	workoutDeleteOperationSlug,
	WorkoutDeleteOutputSchema,
	workoutTemplateDeleteOperationSlug,
} from "../shared/workout-delete-operations";
import {
	ExerciseOverrideUpdateInputSchema,
	exerciseOverrideUpdateOperationSlug,
	ExerciseOverrideUpdateOutputSchema,
	WorkoutEditorContextInputSchema,
	workoutEditorContextOperationSlug,
	WorkoutEditorContextOutputSchema,
	workoutEditorSaveOperationSlug,
	workoutTimeCorrectionOperationSlug,
} from "../shared/workout-editor-context-operations";
import {
	WorkoutEditorSaveInputSchema,
	WorkoutEditorSaveOutputSchema,
} from "../shared/workout-editor-operations";
import { fitnessClientRoutes } from "../shared/workout-editor-routes";
import {
	WorkoutTimeCorrectionInputSchema,
	WorkoutTimeCorrectionOutputSchema,
} from "../shared/workout-time-operations";
import { fitnessBrowse } from "./browse";
import { fitnessCalendarSources } from "./calendar-sources";
import { fitnessConfigSchema } from "./config";
import { fitnessDeclaredQueries } from "./queries";
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
	queries: fitnessDeclaredQueries,
	configSchema: fitnessConfigSchema,
	signalSchemas: fitnessSignalSchemas(),
	calendarSources: fitnessCalendarSources(),
	userSettingsSchema: fitnessUserSettingsSchema,
	relationshipSchemas: fitnessRelationshipSchemas(),
	metadata: {
		name: "Fitness",
		version: "1.0.0",
		icon: "heart-pulse",
		packageId: PLUGIN_PACKAGE_ID,
		description: "Track workouts, measurements, and progress.",
	},
	entitySchemas: fitnessEntitySchemas.map((schema) => {
		const browse = fitnessBrowse(schema.slug);
		return browse === undefined ? schema : Object.assign({}, schema, { browse });
	}),
	workflows: [
		{ slug: "import", scriptSlug: "workflow.import" },
		{ slug: "import-application", scriptSlug: "workflow.import-application" },
		{ slug: "import-merge", scriptSlug: "workflow.import-merge" },
	],
	userBootstrap: [
		{
			slug: "initialize-workspace",
			description: "Initialize the user's fitness workspace",
			entities: [{ properties: {}, name: "Fitness Library", entitySchemaSlug: "fitness-library" }],
		},
	],
	memberships: [
		{
			slug: "fitness-library",
			memberEntitySchemaSlugs: ["exercise"],
			targetEntitySchemaSlug: "fitness-library",
			relationshipSchemaSlug: "in-fitness-library",
			join: {
				events: false,
				providerImport: true,
				entityCreate: ["exercise"],
				kernelCollectionAdd: false,
			},
		},
	],
	providers: [
		{
			name: "Free Exercise DB",
			rootEntitySchemaSlug: "exercise",
			slug: "exercise.free-exercise-db",
			information: { source: "free-exercise-db" },
		},
		{
			name: "Exercise Target Fitness Catalog",
			rootEntitySchemaSlug: "exercise-target",
			slug: "exercise-target.fitness-catalog",
			information: { source: "fitness-catalog" },
		},
		{
			name: "Exercise Equipment Fitness Catalog",
			rootEntitySchemaSlug: "exercise-equipment",
			slug: "exercise-equipment.fitness-catalog",
			information: { source: "fitness-catalog" },
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
				inputSchema: timezoneUploadInputSchema(
					"OpenScale export",
					"OpenScale measurements export CSV",
				),
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
	hooks: [
		{
			position: 110,
			stage: "before",
			name: "Freeze workout taxonomy",
			slug: "fitness.workout-exercise",
			scriptSlug: "policy.workout-exercise",
			targets: (["create", "update"] as const).map((operation) => ({
				operation,
				resource: "event" as const,
				entitySchemaSlug: "exercise",
				eventSchemaSlug: "workout-exercise",
			})),
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
	client: {
		homeView: null,
		routes: fitnessClientRoutes,
		apiVersion: CLIENT_API_VERSION,
		analyticsSections: {
			fitness: {
				sortOrder: 20,
				name: "Fitness",
				icon: "dumbbell",
				exportName: "fitness-analytics",
			},
		},
		assistantStarters: [
			"Summarize my workouts this week",
			"How has my strongest lift progressed this year?",
			"Log today's bodyweight",
		],
		entities: {
			"measurement-metric": { listPresentation: "entity-row", gridPresentation: "entity-card" },
			workout: {
				detailPage: "workout-detail",
				listPresentation: "workout-row",
				gridPresentation: "workout-card",
			},
			"workout-template": {
				listPresentation: "entity-row",
				gridPresentation: "entity-card",
				detailPage: "workout-template-detail",
			},
			exercise: {
				createRoute: "/exercises/new",
				detailPage: "exercise-detail",
				listPresentation: "entity-row",
				gridPresentation: "entity-card",
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
			"fitness-analytics": {
				kind: "analytics-section",
				automaticEntityPresentations: false,
				entry: "client/analytics/section.tsx",
			},
			workouts: {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/workouts/screen.tsx",
			},
			"fitness-home": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/home/screen.tsx",
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
			"workout-editor": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/workout-editor/page.tsx",
			},
			"exercise-editor": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/exercise-editor/page.tsx",
			},
			"workout-template-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/workout-template/screen.tsx",
			},
		},
	},
	operations: [
		{
			auth: "user",
			demoAccess: "protected",
			title: "Delete workout",
			slug: workoutDeleteOperationSlug,
			scriptSlug: "operation.workout-delete",
			input: operationJsonSchema(WorkoutDeleteInputSchema),
			output: operationJsonSchema(WorkoutDeleteOutputSchema),
			hints: { readOnly: false, destructive: true, idempotent: false },
			description:
				"Permanently delete a workout and its composed exercise and set data. Returns the deleted workout ID.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			title: "Delete workout template",
			slug: workoutTemplateDeleteOperationSlug,
			scriptSlug: "operation.workout-template-delete",
			input: operationJsonSchema(WorkoutDeleteInputSchema),
			output: operationJsonSchema(WorkoutDeleteOutputSchema),
			hints: { readOnly: false, destructive: true, idempotent: false },
			description:
				"Permanently delete a workout template and its composed exercise and set data. Returns the deleted template ID.",
		},
		{
			auth: "user",
			title: "Save workout",
			demoAccess: "protected",
			slug: workoutEditorSaveOperationSlug,
			scriptSlug: "operation.workout-editor-save",
			input: operationJsonSchema(WorkoutEditorSaveInputSchema),
			output: operationJsonSchema(WorkoutEditorSaveOutputSchema),
			hints: { readOnly: false, idempotent: false, destructive: true },
			description:
				"Create or update a workout or template, including exercises and sets. Conflict snapshots reject stale updates; repeated creation calls can create additional workouts.",
		},
		{
			auth: "user",
			demoAccess: "allowed",
			title: "Load workout editor",
			slug: workoutEditorContextOperationSlug,
			scriptSlug: "operation.workout-editor-context",
			input: operationJsonSchema(WorkoutEditorContextInputSchema),
			output: operationJsonSchema(WorkoutEditorContextOutputSchema),
			hints: { readOnly: true, idempotent: true, destructive: false },
			description:
				"Read workout editor preferences and Pro availability for the current user without changing settings or workout data.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			title: "Update exercise preferences",
			slug: exerciseOverrideUpdateOperationSlug,
			scriptSlug: "operation.exercise-override-update",
			input: operationJsonSchema(ExerciseOverrideUpdateInputSchema),
			output: operationJsonSchema(ExerciseOverrideUpdateOutputSchema),
			hints: { readOnly: false, idempotent: true, destructive: true },
			description:
				"Change personal exercise preferences on its fitness library membership. Returns whether the exercise was saved or missing.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			title: "Merge exercises",
			slug: exerciseMergeOperationSlug,
			scriptSlug: "operation.exercise-merge",
			input: operationJsonSchema(ExerciseMergeInputSchema),
			output: operationJsonSchema(ExerciseMergeOutputSchema),
			hints: { readOnly: false, destructive: true, idempotent: false },
			description:
				"Merge a custom exercise into another exercise, rewriting references and removing the source exercise. This permanently changes existing workout data.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			title: "Correct workout time",
			slug: workoutTimeCorrectionOperationSlug,
			scriptSlug: "operation.workout-time-correction",
			input: operationJsonSchema(WorkoutTimeCorrectionInputSchema),
			output: operationJsonSchema(WorkoutTimeCorrectionOutputSchema),
			hints: { readOnly: false, destructive: true, idempotent: false },
			description:
				"Correct a workout’s start, end, and active duration using a conflict token. Returns saved, conflict, or invalid; timestamp ordering is validated at runtime.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			title: "Create measurement metric",
			slug: measurementMetricCreateOperationSlug,
			scriptSlug: "operation.measurement-metric-create",
			input: operationJsonSchema(MeasurementMetricCreateInput),
			output: operationJsonSchema(MeasurementMetricCreateOutput),
			hints: { readOnly: false, idempotent: false, destructive: false },
			description:
				"Create a personal measurement metric with its unit and display settings. Returns the created metric ID and automatically pins it when space is available.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			title: "Pin measurement metric",
			slug: measurementMetricPinOperationSlug,
			scriptSlug: "operation.measurement-metric-pin",
			input: operationJsonSchema(MeasurementMetricPinInput),
			output: operationJsonSchema(MeasurementMetricPinOutput),
			hints: { readOnly: false, idempotent: true, destructive: false },
			description:
				"Set whether a measurement metric is pinned. Enforces the pin limit without changing recorded readings.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			title: "Log measurement",
			slug: measurementReadingLogOperationSlug,
			scriptSlug: "operation.measurement-reading-log",
			input: operationJsonSchema(MeasurementReadingLogInput),
			output: operationJsonSchema(MeasurementReadingLogOutput),
			hints: { readOnly: false, idempotent: false, destructive: false },
			description:
				"Record measurement values at a supplied time for selected metrics. Returns a saved count and completion status; repeated calls can create additional entries.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			title: "Update measurement",
			slug: measurementReadingUpdateOperationSlug,
			scriptSlug: "operation.measurement-reading-update",
			output: operationJsonSchema(MeasurementReadingOutput),
			input: operationJsonSchema(MeasurementReadingUpdateInput),
			hints: { readOnly: false, destructive: true, idempotent: false },
			description:
				"Replace measurement values, comment, and timestamp on an existing entry. Returns the affected reading count.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			title: "Delete measurement",
			slug: measurementReadingDeleteOperationSlug,
			scriptSlug: "operation.measurement-reading-delete",
			output: operationJsonSchema(MeasurementReadingOutput),
			input: operationJsonSchema(MeasurementReadingDeleteInput),
			hints: { readOnly: false, destructive: true, idempotent: false },
			description:
				"Permanently delete an existing measurement entry and its readings. Returns the deleted entry count.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			title: "Add exercise note",
			slug: exerciseNoteOperationSlugs.create,
			scriptSlug: "operation.exercise-note-create",
			output: operationJsonSchema(ExerciseNoteOutput),
			input: operationJsonSchema(ExerciseNoteCreateInput),
			hints: { readOnly: false, idempotent: false, destructive: false },
			description:
				"Create a private text note with an optional rating attached to an exercise and return the saved count.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			title: "Update exercise note",
			slug: exerciseNoteOperationSlugs.update,
			scriptSlug: "operation.exercise-note-update",
			output: operationJsonSchema(ExerciseNoteOutput),
			input: operationJsonSchema(ExerciseNoteUpdateInput),
			hints: { readOnly: false, destructive: true, idempotent: false },
			description:
				"Replace the text or rating of an existing private exercise note. Returns the updated count.",
		},
		{
			auth: "user",
			demoAccess: "protected",
			title: "Delete exercise note",
			slug: exerciseNoteOperationSlugs.delete,
			scriptSlug: "operation.exercise-note-delete",
			output: operationJsonSchema(ExerciseNoteOutput),
			input: operationJsonSchema(ExerciseNoteDeleteInput),
			hints: { readOnly: false, destructive: true, idempotent: false },
			description:
				"Permanently delete an existing private exercise note and return the deleted count.",
		},
	],
});

export default fitnessPlugin;
