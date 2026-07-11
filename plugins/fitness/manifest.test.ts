import { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { fitnessPlugin } from "./manifest";

it("declares the complete fitness-owned source", () => {
	expect(() => Schema.decodeUnknownSync(PluginManifest)(fitnessPlugin)).not.toThrow();
	expect(fitnessPlugin.entitySchemas.map(({ slug }) => slug)).toEqual([
		"exercise",
		"workout",
		"workout-template",
		"measurement",
	]);
	expect(fitnessPlugin.entitySchemas[0].mergeIdentityProperties).toEqual(["kind"]);
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
			slug: "exercise.free-exercise-db",
			information: { source: "free-exercise-db" },
			operations: {
				search: "exercise.free-exercise-db.search",
				details: "exercise.free-exercise-db.details",
			},
		},
	]);
	expect(fitnessPlugin.bindings.schemaProviderLinks).toEqual([
		{ entitySchemaSlug: "exercise", providerSlug: "exercise.free-exercise-db" },
	]);
	expect(fitnessPlugin.scripts).toHaveLength(9);
	expect(fitnessPlugin.scripts.some(({ slug }) => slug.startsWith("activity."))).toBe(false);
	expect(fitnessPlugin.workflows).toEqual([{ slug: "import", scriptSlug: "workflow.import" }]);
	expect(fitnessPlugin.importSources).toEqual([
		expect.objectContaining({ slug: "hevy", workflowSlug: "import" }),
		expect.objectContaining({ slug: "strong_app", workflowSlug: "import" }),
		expect.objectContaining({ slug: "open_scale", workflowSlug: "import" }),
	]);
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
		{
			kind: "script",
			slug: "import.open-scale",
			capabilities: ["artifact-read", "scratch"],
		},
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
			slug: "exercise.free-exercise-db.details",
			providerSlug: "exercise.free-exercise-db",
			providerOperation: "details",
		},
		{
			slug: "exercise.free-exercise-db.preload",
			providerSlug: "exercise.free-exercise-db",
			providerOperation: undefined,
		},
		{
			slug: "exercise.free-exercise-db.search",
			providerSlug: "exercise.free-exercise-db",
			providerOperation: "search",
		},
	]);
	expect(fitnessPlugin.savedViews.every(({ pluginSlug }) => pluginSlug === "fitness")).toBe(true);
});
