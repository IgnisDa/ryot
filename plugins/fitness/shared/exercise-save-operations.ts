import type { EntityEditorAllowlist } from "@ryot-app/plugin-kit/schema";

export const exerciseSaveOperationSlug = "exercise-save";

export const exerciseEditors = {
	exercise: ["exercise-targets", "exercise-uses-equipment"],
} as const satisfies EntityEditorAllowlist;
