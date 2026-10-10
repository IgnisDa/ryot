import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { getExerciseDetails } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Free Exercise DB Details",
	slug: "exercise.free-exercise-db.details",
});

export default defineProvider({
	manifest,
	operation: "details",
	run: (input, host, execution) => getExerciseDetails(input, host, execution),
});
