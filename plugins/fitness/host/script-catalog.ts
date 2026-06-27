import { manifest as manifest2 } from "../backend/automations/notification.sandbox";
import { manifest as manifest0 } from "../backend/automations/workout-created.sandbox";
import { manifest as manifest5 } from "../backend/imports/hevy.sandbox";
import { manifest as manifest6 } from "../backend/imports/import.sandbox";
import { manifest as manifest7 } from "../backend/imports/open-scale.sandbox";
import { manifest as manifest8 } from "../backend/imports/strong-app.sandbox";
import { manifest as manifest3 } from "../backend/providers/exercise/free-exercise-db/details.sandbox";
import { manifest as manifest4 } from "../backend/providers/exercise/free-exercise-db/preload.sandbox";
import { manifest as manifest1 } from "../backend/providers/exercise/free-exercise-db/search.sandbox";

export const fitnessScripts = [
	{ ...manifest2, entry: "backend/automations/notification.sandbox.ts" },
	{ ...manifest0, entry: "backend/automations/workout-created.sandbox.ts" },
	{ ...manifest5, entry: "backend/imports/hevy.sandbox.ts" },
	{ ...manifest6, entry: "backend/imports/import.sandbox.ts" },
	{ ...manifest7, entry: "backend/imports/open-scale.sandbox.ts" },
	{ ...manifest8, entry: "backend/imports/strong-app.sandbox.ts" },
	{
		...manifest3,
		providerSlug: "exercise.free-exercise-db",
		providerOperation: "details",
		entry: "backend/providers/exercise/free-exercise-db/details.sandbox.ts",
	},
	{
		...manifest4,
		providerSlug: "exercise.free-exercise-db",
		entry: "backend/providers/exercise/free-exercise-db/preload.sandbox.ts",
	},
	{
		...manifest1,
		providerSlug: "exercise.free-exercise-db",
		providerOperation: "search",
		entry: "backend/providers/exercise/free-exercise-db/search.sandbox.ts",
	},
] as const;
