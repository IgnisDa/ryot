import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { resolveExercise } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Free Exercise DB Resolve",
	slug: "exercise.free-exercise-db.resolve",
	capabilities: ["httpCall", "getCachedValue", "setCachedValue"],
});

export default defineProvider({
	manifest,
	operation: "resolve",
	run: (input, host, execution) => resolveExercise(input, host, execution),
});
