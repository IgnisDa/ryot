import { EntityEditorSaveOutput, EntityEditorSubmission } from "@ryot-app/plugin-kit/schema";

export const exerciseSaveOperationSlug = "exercise-save";

export const exerciseSaveInput = EntityEditorSubmission;
export const exerciseSaveOutput = EntityEditorSaveOutput;

export const exerciseEditorEntitySchemaSlug = "exercise";
export const exerciseEditorRelationshipSlugs = [
	"exercise-targets",
	"exercise-uses-equipment",
] as const;
