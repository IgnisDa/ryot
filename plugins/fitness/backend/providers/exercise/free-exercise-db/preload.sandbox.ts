import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Schema } from "@ryot-app/sandbox-sdk/effect";

import { preloadExercises, preloadResultSchema } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	requiredSystemConfigKeys: [],
	name: "Free Exercise DB Preload",
	slug: "exercise.free-exercise-db.preload",
	requiredPluginConfigKeys: ["exercisePreloadLimit"],
	capabilities: [
		"httpCall",
		"getCachedValue",
		"setCachedValue",
		"getPluginConfig",
		"upsertGlobalEntities",
	],
});

export default defineScript({
	manifest,
	input: Schema.Unknown,
	output: preloadResultSchema,
	run: (_, host, execution) => preloadExercises(host, execution),
});
