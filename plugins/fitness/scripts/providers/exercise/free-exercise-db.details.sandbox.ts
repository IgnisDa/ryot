import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { getExerciseDetails } from "./free-exercise-db";

export const manifest = defineManifest({
	kind: "provider",
	requiredAppConfigKeys: [],
	name: "Free Exercise DB Details",
	slug: "exercise.free-exercise-db.details",
	capabilities: ["httpCall", "getCachedValue", "setCachedValue"],
});

export default defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => getExerciseDetails(input, host),
});
