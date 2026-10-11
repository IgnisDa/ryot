import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import {
	exerciseEditorEntitySchemaSlug,
	exerciseEditorRelationshipSlugs,
	exerciseSaveInput,
	exerciseSaveOutput,
} from "../../shared/exercise-save-operations";

export const manifest = defineManifest({
	kind: "operation",
	name: "Save exercise",
	slug: "operation.exercise-save",
});

const allowedRelationshipSlugs: ReadonlyArray<string> = exerciseEditorRelationshipSlugs;

export default defineOperation({
	manifest,
	input: exerciseSaveInput,
	output: exerciseSaveOutput,
	run: (input, host) =>
		input.entitySchemaSlug !== exerciseEditorEntitySchemaSlug ||
		input.relationships.some(
			({ relationshipSchemaSlug }) => !allowedRelationshipSlugs.includes(relationshipSchemaSlug),
		)
			? Effect.succeed({ kind: "invalid", message: "Unsupported exercise save" } as const)
			: host.saveUserEntity(input),
});
