import { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { Schema } from "effect";
import { assert, expect, it } from "vitest";

import { FitnessCreateImportRunBody } from "./import-sources";
import { fitnessPlugin } from "./manifest";

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
	expect(() => Schema.decodeUnknownSync(PluginManifest)(fitnessPlugin)).not.toThrow();
	expect(fitnessPlugin.entitySchemas.map(({ slug }) => slug)).toEqual([
		"exercise",
		"workout",
		"workout-template",
		"measurement",
	]);
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
	expect(fitnessPlugin.scripts).toHaveLength(9);
	expect(fitnessPlugin.scripts.some(({ slug }) => slug.startsWith("activity."))).toBe(false);
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
		fitnessPlugin.scripts
			.filter(({ slug }) => slug.startsWith("import."))
			.map(({ capabilities, kind, slug }) => ({ capabilities, kind, slug })),
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
	expect(
		fitnessPlugin.scripts.find(({ slug }) => slug === "exercise.free-exercise-db.preload"),
	).toEqual(
		expect.objectContaining({
			providerSlug: "exercise.free-exercise-db",
			requiredPluginConfigKeys: ["exercisePreloadLimit"],
		}),
	);
	expect(
		fitnessPlugin.scripts.flatMap((script) =>
			"providerSlug" in script
				? [
						{
							slug: script.slug,
							providerSlug: script.providerSlug,
							providerOperation:
								"providerOperation" in script ? script.providerOperation : undefined,
						},
					]
				: [],
		),
	).toEqual([
		{
			providerOperation: "details",
			slug: "exercise.free-exercise-db.details",
			providerSlug: "exercise.free-exercise-db",
		},
		{
			providerOperation: undefined,
			slug: "exercise.free-exercise-db.preload",
			providerSlug: "exercise.free-exercise-db",
		},
		{
			providerOperation: "search",
			slug: "exercise.free-exercise-db.search",
			providerSlug: "exercise.free-exercise-db",
		},
	]);
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
