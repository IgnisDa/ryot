import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { searchExercises } from "./shared";

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
	run: (input, host, execution) => searchExercises(input, host, execution),
});
