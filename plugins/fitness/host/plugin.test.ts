import {
	AuthoredPluginManifest,
	CLIENT_API_VERSION,
} from "@ryot-app/contract/modules/plugins/manifest";
import { Schema } from "effect";
import { assert, expect, it } from "vitest";

import { manifest as userBootstrapManifest } from "../backend/bootstrap/user-bootstrap.sandbox";
import { manifest as hevyManifest } from "../backend/imports/hevy.sandbox";
import { manifest as openScaleManifest } from "../backend/imports/open-scale.sandbox";
import { manifest as settingsManifest } from "../backend/imports/settings.sandbox";
import { manifest as strongAppManifest } from "../backend/imports/strong-app.sandbox";
import { FitnessCreateImportRunBody } from "./import-sources";
import { fitnessPlugin } from "./plugin";

const expectedImportSources = [
	{
		slug: "hevy",
		timezone: true,
		label: "Hevy export",
		docsUrl: "https://docs.ryot.io/importing/hevy.html",
		description: "Import workouts from a Hevy CSV export",
	},
	{
		timezone: true,
		slug: "strong_app",
		label: "Strong App export",
		description: "Import workouts from a Strong CSV export",
		docsUrl: "https://docs.ryot.io/importing/strong-app.html",
	},
	{
		timezone: false,
		slug: "open_scale",
		label: "OpenScale export",
		docsUrl: "https://docs.ryot.io/importing/open-scale.html",
		description: "Import measurements from an OpenScale CSV export",
	},
] as const;

it("declares the complete fitness-owned source", () => {
	expect(() => Schema.decodeSync(AuthoredPluginManifest)(fitnessPlugin)).not.toThrow();
	expect(fitnessPlugin.entitySchemas.map(({ slug }) => slug)).toEqual([
		"fitness-library",
		"exercise",
		"exercise-target",
		"exercise-equipment",
		"workout",
		"workout-template",
		"measurement",
	]);
	expect(fitnessPlugin.relationshipSchemas.map(({ slug }) => slug)).toEqual([
		"in-fitness-library",
		"exercise-targets",
		"exercise-uses-equipment",
		"workout-repeated-from",
		"workout-to-workout-template",
	]);
	expect(fitnessPlugin.signalSchemas.map(({ slug }) => slug)).toEqual([
		"workout.created",
		"exercise.context-changed",
		"workout.context-changed",
	]);
	expect(
		fitnessPlugin.signalSchemas
			.filter(({ slug }) => slug !== "workout.created")
			.map(({ catalogState, audiencePolicy, propertiesSchema, notificationHookSlug }) => ({
				catalogState,
				audiencePolicy,
				propertiesSchema,
				notificationHookSlug,
			})),
	).toEqual([
		{
			catalogState: "hidden",
			notificationHookSlug: "fitness.notification",
			propertiesSchema: { fields: {}, unknownKeys: "strict" },
			audiencePolicy: {
				role: "entity",
				kind: "dependent_event_owners",
				eventSchemaSlug: "workout-set",
			},
		},
		{
			catalogState: "hidden",
			notificationHookSlug: "fitness.notification",
			propertiesSchema: { fields: {}, unknownKeys: "strict" },
			audiencePolicy: {
				role: "session",
				kind: "dependent_event_owners",
				eventSchemaSlug: "workout-set",
			},
		},
	]);
	expect(fitnessPlugin.client).toEqual({
		homeView: null,
		apiVersion: CLIENT_API_VERSION,
		entities: {
			exercise: { listPresentation: "entity-row", gridPresentation: "entity-card" },
			measurement: { listPresentation: "entity-row", gridPresentation: "entity-card" },
			"workout-template": { listPresentation: "entity-row", gridPresentation: "entity-card" },
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
		},
	});
	const exercise = fitnessPlugin.entitySchemas.find(({ slug }) => slug === "exercise");
	assert(exercise && "mergeIdentityProperties" in exercise);
	expect(exercise.mergeIdentityProperties).toEqual(["kind"]);
	expect(exercise.propertiesSchema.fields).not.toHaveProperty("muscles");
	expect(exercise.propertiesSchema.fields).not.toHaveProperty("equipment");
	const exerciseTarget = fitnessPlugin.entitySchemas.find(({ slug }) => slug === "exercise-target");
	assert(exerciseTarget);
	assert("description" in exerciseTarget.propertiesSchema.fields);
	expect(exerciseTarget.propertiesSchema.fields).toMatchObject({
		description: { type: "string" },
		kind: {
			type: "enum",
			validation: { required: true },
			choices: {
				kind: "static",
				values: [
					{ value: "muscle" },
					{ value: "muscle_region" },
					{ value: "tendon" },
					{ value: "fascia" },
					{ value: "joint" },
					{ value: "region" },
				],
			},
		},
	});
	expect(exerciseTarget.propertiesSchema.fields["description"]).not.toHaveProperty("validation");
	const exerciseEquipment = fitnessPlugin.entitySchemas.find(
		({ slug }) => slug === "exercise-equipment",
	);
	assert(exerciseEquipment);
	assert("description" in exerciseEquipment.propertiesSchema.fields);
	expect(exerciseEquipment.propertiesSchema.fields).toMatchObject({
		description: { type: "string" },
	});
	expect(exerciseEquipment.propertiesSchema.fields["description"]).not.toHaveProperty("validation");
	const exerciseTargetsRelationship = fitnessPlugin.relationshipSchemas.find(
		({ slug }) => slug === "exercise-targets",
	);
	assert(exerciseTargetsRelationship);
	expect(exerciseTargetsRelationship).toMatchObject({
		sourceEntitySchemaSlug: "exercise",
		targetEntitySchemaSlug: "exercise-target",
		propertiesSchema: {
			fields: {
				role: {
					type: "enum",
					choices: {
						kind: "static",
						values: [{ value: "primary" }, { value: "secondary" }, { value: "stabilizer" }],
					},
				},
			},
		},
	});
	assert("role" in exerciseTargetsRelationship.propertiesSchema.fields);
	expect(exerciseTargetsRelationship.propertiesSchema.fields.role).not.toHaveProperty("validation");
	expect(exerciseTargetsRelationship.propertiesSchema.fields.role).not.toHaveProperty("default");
	const exerciseEquipmentRelationship = fitnessPlugin.relationshipSchemas.find(
		({ slug }) => slug === "exercise-uses-equipment",
	);
	assert(exerciseEquipmentRelationship);
	expect(exerciseEquipmentRelationship).toMatchObject({
		propertiesSchema: { fields: {} },
		sourceEntitySchemaSlug: "exercise",
		targetEntitySchemaSlug: "exercise-equipment",
	});
	expect(fitnessPlugin.configSchema).toMatchObject({ fields: {}, unknownKeys: "strict" });
	expect(
		fitnessPlugin.entitySchemas
			.filter((schema) => schema.slug !== "exercise")
			.every((schema) => !("mergeIdentityProperties" in schema)),
	).toBe(true);
	expect(fitnessPlugin.crons).toEqual([]);
	expect(fitnessPlugin.userBootstrap).toEqual([
		{
			slug: "initialize-workspace",
			scriptSlug: "bootstrap.fitness-workspace",
			description: "Initialize the user's fitness workspace",
		},
	]);
	expect(fitnessPlugin.providers).toEqual([
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
	]);
	expect(fitnessPlugin.workflows).toEqual([
		{ slug: "import", scriptSlug: "workflow.import" },
		{ slug: "import-application", scriptSlug: "workflow.import-application" },
		{ slug: "import-merge", scriptSlug: "workflow.import-merge" },
	]);
	expect(fitnessPlugin.importSources.map(({ slug }) => slug)).toEqual(
		expectedImportSources.map(({ slug }) => slug),
	);
	for (const [index, source] of fitnessPlugin.importSources.entries()) {
		const expected = expectedImportSources[index];
		assert(expected);
		expect(source).toMatchObject({
			workflowSlug: "import",
			description: expected.description,
			exportHelp: { docsUrl: expected.docsUrl },
		});
		expect(source.inputSchema).toEqual({
			unknownKeys: "strict",
			fields: {
				uploadToken: {
					position: 0,
					type: "string",
					label: expected.label,
					description: expect.any(String),
					validation: { minLength: 1, required: true },
					format: { kind: "upload", allowedFileExtensions: ["csv"] },
				},
				...(expected.timezone
					? {
							timezone: {
								position: 1,
								type: "string",
								label: "Timezone",
								format: { kind: "timezone" },
								validation: { required: true },
								description: expect.any(String),
							},
						}
					: {}),
			},
		});
		expect(() =>
			Schema.decodeUnknownSync(FitnessCreateImportRunBody)({
				source: source.slug,
				uploadToken: "upload-1",
				...(expected.timezone ? { timezone: "Asia/Kolkata" } : {}),
			}),
		).not.toThrow();
	}
	expect(
		[hevyManifest, openScaleManifest, strongAppManifest, settingsManifest].map(
			({ kind, slug }) => ({ kind, slug }),
		),
	).toEqual([
		{ kind: "script", slug: "import.hevy" },
		{ kind: "script", slug: "import.open-scale" },
		{ kind: "script", slug: "import.strong-app" },
		{ kind: "script", slug: "import.settings" },
	]);
	expect(userBootstrapManifest).toMatchObject({
		kind: "script",
		slug: "bootstrap.fitness-workspace",
	});
	expect(fitnessPlugin.savedViews.every(({ pluginSlug }) => pluginSlug === "fitness")).toBe(true);
	expect(
		fitnessPlugin.savedViews.map(({ name, settings }) => ({
			name,
			entitySchemaSlug: (settings["addAction"] as { readonly entitySchemaSlug: string })
				.entitySchemaSlug,
		})),
	).toEqual([
		{ name: "All Exercises", entitySchemaSlug: "exercise" },
		{ name: "All Workouts", entitySchemaSlug: "workout" },
		{ name: "All Measurements", entitySchemaSlug: "measurement" },
		{ name: "All Workout Templates", entitySchemaSlug: "workout-template" },
	]);
});

it("binds workout context and set policies before stream-based record recomputation", () => {
	const contextPolicy = fitnessPlugin.hooks.find(({ slug }) => slug === "fitness.workout-context");
	const setPolicy = fitnessPlugin.hooks.find(({ slug }) => slug === "fitness.workout-set");
	const recordsHook = fitnessPlugin.hooks.find(({ slug }) => slug === "fitness.workout-records");
	const contextChangeHook = fitnessPlugin.hooks.find(
		({ slug }) => slug === "fitness.workout-context-changed",
	);
	const contextRecordsHook = fitnessPlugin.hooks.find(
		({ slug }) => slug === "fitness.workout-context-records",
	);
	const notificationHook = fitnessPlugin.hooks.find(({ slug }) => slug === "fitness.notification");

	expect(contextPolicy).toMatchObject({
		position: 100,
		stage: "before",
		scriptSlug: "policy.workout-context",
		targets: expect.arrayContaining([
			{ resource: "entity", operation: "update", entitySchemaSlug: "exercise" },
			{ resource: "entity", operation: "update", entitySchemaSlug: "workout" },
		]),
	});
	expect(setPolicy).toMatchObject({
		position: 110,
		stage: "before",
		scriptSlug: "policy.workout-set",
	});
	expect(recordsHook).toMatchObject({
		stage: "after",
		delivery: "async",
		frequency: "batch",
		executionScope: "user",
		scriptSlug: "automation.workout-records",
	});
	expect(recordsHook).not.toHaveProperty("causationSources");
	expect(recordsHook?.targets).toEqual(
		["create", "update", "delete"].map((operation) => ({
			operation,
			resource: "event",
			entitySchemaSlug: "exercise",
			eventSchemaSlug: "workout-set",
		})),
	);
	expect(contextChangeHook).toMatchObject({
		stage: "after",
		delivery: "async",
		scriptSlug: "automation.workout-context-changed",
		targets: [
			{ resource: "entity", operation: "update", entitySchemaSlug: "exercise" },
			{ resource: "entity", operation: "update", entitySchemaSlug: "workout" },
		],
	});
	expect(contextChangeHook).not.toHaveProperty("executionScope");
	expect(contextChangeHook).not.toHaveProperty("frequency");
	expect(contextRecordsHook).toMatchObject({
		stage: "after",
		delivery: "async",
		executionScope: "user",
		scriptSlug: "automation.workout-records",
		targets: [
			{ operation: "emit", resource: "signal", signalSchemaSlug: "exercise.context-changed" },
			{ operation: "emit", resource: "signal", signalSchemaSlug: "workout.context-changed" },
		],
	});
	expect(contextRecordsHook).not.toHaveProperty("frequency");
	expect(notificationHook?.targets).toEqual([
		{ operation: "emit", resource: "signal", signalSchemaSlug: "workout.created" },
		{ operation: "emit", resource: "signal", signalSchemaSlug: "exercise.context-changed" },
		{ operation: "emit", resource: "signal", signalSchemaSlug: "workout.context-changed" },
	]);
});
