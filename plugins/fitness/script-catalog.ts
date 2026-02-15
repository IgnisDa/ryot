import { manifest as manifest2 } from "./scripts/automations/notification.sandbox";
import { manifest as manifest0 } from "./scripts/automations/workout-created.sandbox";
import { manifest as manifest3 } from "./scripts/providers/exercise/free-exercise-db.details.sandbox";
import { manifest as manifest4 } from "./scripts/providers/exercise/free-exercise-db.preload.sandbox";
import { manifest as manifest1 } from "./scripts/providers/exercise/free-exercise-db.search.sandbox";

export const fitnessScripts = [
	{ ...manifest2, entry: "scripts/automations/notification.sandbox.ts" },
	{ ...manifest0, entry: "scripts/automations/workout-created.sandbox.ts" },
	{
		...manifest3,
		providerSlug: "exercise.free-exercise-db",
		providerOperation: "details",
		entry: "scripts/providers/exercise/free-exercise-db.details.sandbox.ts",
	},
	{
		...manifest4,
		providerSlug: "exercise.free-exercise-db",
		entry: "scripts/providers/exercise/free-exercise-db.preload.sandbox.ts",
	},
	{
		...manifest1,
		providerSlug: "exercise.free-exercise-db",
		providerOperation: "search",
		entry: "scripts/providers/exercise/free-exercise-db.search.sandbox.ts",
	},
] as const;
