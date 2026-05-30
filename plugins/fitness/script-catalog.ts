import { manifest as manifest2 } from "./backend/scripts/automations/notification.sandbox";
import { manifest as manifest0 } from "./backend/scripts/automations/workout-created.sandbox";
import { manifest as manifest5 } from "./backend/scripts/imports/hevy.sandbox";
import { manifest as manifest6 } from "./backend/scripts/imports/import.sandbox";
import { manifest as manifest7 } from "./backend/scripts/imports/open-scale.sandbox";
import { manifest as manifest8 } from "./backend/scripts/imports/strong-app.sandbox";
import { manifest as manifest3 } from "./backend/scripts/providers/exercise/free-exercise-db.details.sandbox";
import { manifest as manifest4 } from "./backend/scripts/providers/exercise/free-exercise-db.preload.sandbox";
import { manifest as manifest1 } from "./backend/scripts/providers/exercise/free-exercise-db.search.sandbox";

export const fitnessScripts = [
	{ ...manifest2, entry: "backend/scripts/automations/notification.sandbox.ts" },
	{ ...manifest0, entry: "backend/scripts/automations/workout-created.sandbox.ts" },
	{ ...manifest5, entry: "backend/scripts/imports/hevy.sandbox.ts" },
	{ ...manifest6, entry: "backend/scripts/imports/import.sandbox.ts" },
	{ ...manifest7, entry: "backend/scripts/imports/open-scale.sandbox.ts" },
	{ ...manifest8, entry: "backend/scripts/imports/strong-app.sandbox.ts" },
	{
		...manifest3,
		providerSlug: "exercise.free-exercise-db",
		providerOperation: "details",
		entry: "backend/scripts/providers/exercise/free-exercise-db.details.sandbox.ts",
	},
	{
		...manifest4,
		providerSlug: "exercise.free-exercise-db",
		entry: "backend/scripts/providers/exercise/free-exercise-db.preload.sandbox.ts",
	},
	{
		...manifest1,
		providerSlug: "exercise.free-exercise-db",
		providerOperation: "search",
		entry: "backend/scripts/providers/exercise/free-exercise-db.search.sandbox.ts",
	},
] as const;
