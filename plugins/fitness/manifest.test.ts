import { PluginManifest } from "@ryot/plugin-kit/manifest";
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
	expect(fitnessPlugin.crons).toEqual([]);
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
	expect(fitnessPlugin.scripts).toHaveLength(5);
	expect(
		fitnessPlugin.scripts.find(({ slug }) => slug === "exercise.free-exercise-db.preload"),
	).toEqual(
		expect.objectContaining({
			providerSlug: "exercise.free-exercise-db",
			requiredAppConfigKeys: ["builtinExercisePreloadLimit"],
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
