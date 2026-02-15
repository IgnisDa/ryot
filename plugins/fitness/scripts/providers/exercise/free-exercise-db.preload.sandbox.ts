import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Schema } from "@ryot/sandbox-sdk/effect";

import { preloadExercises, preloadResultSchema } from "./free-exercise-db";

export const manifest = defineManifest({
	kind: "script",
	name: "Free Exercise DB Preload",
	slug: "exercise.free-exercise-db.preload",
	requiredAppConfigKeys: ["builtinExercisePreloadLimit"],
	capabilities: [
		"httpCall",
		"getCachedValue",
		"setCachedValue",
		"getAppConfigValue",
		"upsertGlobalEntities",
	],
});

export default defineScript({
	manifest,
	input: Schema.Unknown,
	output: preloadResultSchema,
	run: (_, host) => preloadExercises(host),
});
