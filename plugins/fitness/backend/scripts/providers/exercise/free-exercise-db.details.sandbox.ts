import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { getExerciseDetails } from "./free-exercise-db";

export const manifest = defineManifest({
	kind: "provider",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Free Exercise DB Details",
	slug: "exercise.free-exercise-db.details",
	capabilities: ["httpCall", "getCachedValue", "setCachedValue"],
});

export default defineProvider({
	manifest,
	operation: "details",
	run: (input, host, execution) => getExerciseDetails(input, host, execution),
});
