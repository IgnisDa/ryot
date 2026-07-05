import { manifest as manifest0 } from "./scripts/automations/workout-created.sandbox";
import { manifest as manifest1 } from "./scripts/providers/exercise/free-exercise-db.sandbox";

export const fitnessScripts = [
	{ ...manifest0, entry: "scripts/automations/workout-created.sandbox.ts" },
	{ ...manifest1, entry: "scripts/providers/exercise/free-exercise-db.sandbox.ts" },
] as const;
