import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { searchExercises } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Free Exercise DB Search",
	slug: "exercise.free-exercise-db.search",
});

export default defineProvider({
	manifest,
	operation: "search",
	run: (input, host, execution) => searchExercises(input, host, execution),
});
