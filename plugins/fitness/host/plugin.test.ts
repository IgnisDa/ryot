import { AuthoredPluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { Schema } from "effect";
import { assert, expect, it } from "vitest";

import { manifest as userBootstrapManifest } from "../backend/bootstrap/user-bootstrap.sandbox";
import { manifest as hevyManifest } from "../backend/imports/hevy.sandbox";
import { manifest as openScaleManifest } from "../backend/imports/open-scale.sandbox";
import { manifest as strongAppManifest } from "../backend/imports/strong-app.sandbox";
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
		"fitness-library",
		"exercise",
		"workout",
		"workout-template",
		"measurement",
	]);
	expect(fitnessPlugin.relationshipSchemas.map(({ slug }) => slug)).toEqual([
		"in-fitness-library",
		"workout-repeated-from",
		"workout-to-workout-template",
	]);
	expect(fitnessPlugin.client).toEqual({
		apiVersion: 1,
		homeView: null,
		entities: {
			exercise: { listPresentation: "entity-row", gridPresentation: "entity-card" },
			workout: { listPresentation: "workout-row", gridPresentation: "workout-card" },
			measurement: { listPresentation: "entity-row", gridPresentation: "entity-card" },
			"workout-template": { listPresentation: "entity-row", gridPresentation: "entity-card" },
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
		},
	});
	const exercise = fitnessPlugin.entitySchemas.find(({ slug }) => slug === "exercise");
	assert(exercise && "mergeIdentityProperties" in exercise);
	expect(exercise.mergeIdentityProperties).toEqual(["kind"]);
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
		[hevyManifest, openScaleManifest, strongAppManifest].map(({ kind, slug, capabilities }) => ({
			kind,
			slug,
			capabilities,
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
	expect(userBootstrapManifest).toMatchObject({
		kind: "script",
		slug: "bootstrap.fitness-workspace",
		capabilities: ["ensureUserEntities"],
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
