import { AuthoredPluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { Schema } from "effect";
import { assert, expect, it } from "vitest";

import { manifest as hevyManifest } from "../backend/imports/hevy.sandbox";
import { manifest as openScaleManifest } from "../backend/imports/open-scale.sandbox";
import { manifest as strongAppManifest } from "../backend/imports/strong-app.sandbox";
import { manifest as preloadManifest } from "../backend/providers/exercise/free-exercise-db/preload.sandbox";
import { FitnessCreateImportRunBody } from "./import-sources";
import { fitnessPlugin } from "./plugin";

const expectedImportSources = [
	{
		slug: "hevy",
		label: "Hevy export",
		docsUrl: "https://docs.ryot.io/importing/hevy.html",
		description: "Import workouts from a Hevy CSV export",
	},
	{
		slug: "strong_app",
		label: "Strong App export",
		description: "Import workouts from a Strong CSV export",
		docsUrl: "https://docs.ryot.io/importing/strong-app.html",
	},
	{
		slug: "open_scale",
		label: "OpenScale export",
		docsUrl: "https://docs.ryot.io/importing/open-scale.html",
		description: "Import measurements from an OpenScale CSV export",
	},
] as const;

it("declares the complete fitness-owned source", () => {
	expect(() => Schema.decodeUnknownSync(AuthoredPluginManifest)(fitnessPlugin)).not.toThrow();
	expect(fitnessPlugin.entitySchemas.map(({ slug }) => slug)).toEqual([
		"exercise",
		"workout",
		"workout-template",
		"measurement",
	]);
	expect(fitnessPlugin.client).toEqual({
		apiVersion: 1,
		entry: "client/index.ts",
		entities: { workout: { listPresentation: "workout-row", gridPresentation: "workout-card" } },
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
		},
	});
	const exercise = fitnessPlugin.entitySchemas[0];
	assert(exercise);
	expect(exercise.mergeIdentityProperties).toEqual(["kind"]);
	expect(fitnessPlugin.configSchema).toMatchObject({
		unknownKeys: "strict",
		fields: { exercisePreloadLimit: { type: "integer", defaultValue: 873 } },
	});
	expect(
		fitnessPlugin.entitySchemas.slice(1).every((schema) => !("mergeIdentityProperties" in schema)),
	).toBe(true);
	expect(fitnessPlugin.crons).toEqual([]);
	expect(fitnessPlugin.userBootstrap).toEqual([]);
	expect(fitnessPlugin.boot).toEqual([
		{
			slug: "preload-exercises",
			scriptSlug: "exercise.free-exercise-db.preload",
			description: "Preload the built-in exercise catalog",
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
			},
		},
	]);
	expect(fitnessPlugin.workflows).toEqual([{ slug: "import", scriptSlug: "workflow.import" }]);
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
			},
		});
		expect(() =>
			Schema.decodeUnknownSync(FitnessCreateImportRunBody)({
				source: source.slug,
				uploadToken: "upload-1",
			}),
		).not.toThrow();
	}
	expect(
		[hevyManifest, openScaleManifest, strongAppManifest].map(({ capabilities, kind, slug }) => ({
			capabilities,
			kind,
			slug,
		})),
	).toEqual([
		{
			kind: "script",
			slug: "import.hevy",
			capabilities: ["artifact-read", "scratch", "getSystemConfig"],
		},
		{ kind: "script", slug: "import.open-scale", capabilities: ["artifact-read", "scratch"] },
		{
			kind: "script",
			slug: "import.strong-app",
			capabilities: ["artifact-read", "scratch", "getSystemConfig"],
		},
	]);
	expect(preloadManifest).toEqual(
		expect.objectContaining({
			kind: "script",
			slug: "exercise.free-exercise-db.preload",
			requiredPluginConfigKeys: ["exercisePreloadLimit"],
		}),
	);
	expect(fitnessPlugin.savedViews.every(({ pluginSlug }) => pluginSlug === "fitness")).toBe(true);
	expect(
		fitnessPlugin.savedViews.map(({ name, entitySchemaSlug }) => ({ name, entitySchemaSlug })),
	).toEqual([
		{ name: "All Exercises", entitySchemaSlug: "exercise" },
		{ name: "All Workouts", entitySchemaSlug: "workout" },
		{ name: "All Measurements", entitySchemaSlug: "measurement" },
		{ name: "All Workout Templates", entitySchemaSlug: "workout-template" },
	]);
});
