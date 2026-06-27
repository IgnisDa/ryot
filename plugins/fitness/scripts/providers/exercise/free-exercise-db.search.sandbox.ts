import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { searchExercises } from "./free-exercise-db";

export const manifest = defineManifest({
	kind: "provider",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Free Exercise DB Search",
	slug: "exercise.free-exercise-db.search",
	capabilities: ["httpCall", "getCachedValue", "setCachedValue"],
});

export default defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => searchExercises(input, host),
});
