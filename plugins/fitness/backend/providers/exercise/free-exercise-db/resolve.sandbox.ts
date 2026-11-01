import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { resolveExercise } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Free Exercise DB Resolve",
	slug: "exercise.free-exercise-db.resolve",
});

export default defineProvider({
	manifest,
	operation: "resolve",
	run: (input, host, execution) => resolveExercise(input, host, execution),
});
