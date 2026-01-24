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
			driverRef: "exercise.free-exercise-db",
			description: "Preload the built-in exercise catalog",
		},
	]);
	expect(fitnessPlugin.scripts).toHaveLength(3);
	expect(fitnessPlugin.scripts.find(({ slug }) => slug === "exercise.free-exercise-db")).toEqual(
		expect.objectContaining({
			requiredAppConfigKeys: ["builtinExercisePreloadLimit"],
		}),
	);
	expect(fitnessPlugin.savedViews.every(({ pluginSlug }) => pluginSlug === "fitness")).toBe(true);
});
