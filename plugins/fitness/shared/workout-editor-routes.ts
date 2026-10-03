import { PLUGIN_PACKAGE_ID } from "./plugin-identity";

export const fitnessClientRoutes = {
	"/workouts/new": "workout-editor",
	"/templates/new": "workout-editor",
	"/exercises/new": "exercise-editor",
	"/workout-editor": "workout-editor",
	"/workouts/$workoutId/edit": "workout-editor",
	"/workouts/$workoutId/repeat": "workout-editor",
	"/templates/$templateId/edit": "workout-editor",
	"/exercises/$exerciseId/edit": "exercise-editor",
	"/templates/$templateId/start": "workout-editor",
	"/workouts/$workoutId/create-template": "workout-editor",
} as const;

export const fitnessRoute = (path: string) => ({
	path,
	search: {},
	packageId: PLUGIN_PACKAGE_ID,
	kind: "plugin-route" as const,
});

export const workoutEditorResumeTarget = {
	search: "",
	path: "/workout-editor",
	packageId: PLUGIN_PACKAGE_ID,
	kind: "plugin-route" as const,
};
