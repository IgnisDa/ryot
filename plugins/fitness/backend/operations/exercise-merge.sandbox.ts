import {
	CHANGE_SET_LIMITS,
	entityUpdateTarget,
	existingEntity,
} from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";
import { executeRyotqlRecipe, readAllRyotqlPages } from "@ryot-app/plugin-backend-sdk/ryotql";

import {
	ExerciseMergeInputSchema,
	ExerciseMergeOutputSchema,
} from "../../shared/exercise-merge-operations";
import {
	exerciseMergeLinksRecipe,
	exerciseMergeSubjectsRecipe,
	exerciseMergeTemplatesRecipe,
} from "../../shared/exercise-merge-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import { WorkoutEditorPropertiesSchema } from "../../shared/workout-editor-recipes";

export const manifest = defineManifest({
	kind: "operation",
	name: "Merge exercise",
	slug: "operation.exercise-merge",
});

const reference = { kind: "self" } as const;

const TemplateOccurrencesSchema = Schema.Array(WorkoutEditorPropertiesSchema);

const swapTemplateExercise = (
	properties: typeof WorkoutEditorPropertiesSchema.Type,
	mergeFrom: string,
	mergeInto: string,
) => {
	const occurrences = Schema.decodeUnknownOption(TemplateOccurrencesSchema)(
		properties["exercises"],
	);
	return occurrences._tag === "Some" &&
		occurrences.value.some(({ exerciseId }) => exerciseId === mergeFrom)
		? {
				...properties,
				exercises: occurrences.value.map((occurrence) =>
					occurrence["exerciseId"] === mergeFrom
						? Object.assign({}, occurrence, { exerciseId: mergeInto })
						: occurrence,
				),
			}
		: null;
};

export default defineOperation({
	manifest,
	input: ExerciseMergeInputSchema,
	output: ExerciseMergeOutputSchema,
	run: ({ mergeFrom, mergeInto }, host) =>
		Effect.gen(function* () {
			if (mergeFrom === mergeInto) {
				return { output: { kind: "same" } as const };
			}
			const subjects = yield* executeRyotqlRecipe(
				host.executeRyotql,
				exerciseMergeSubjectsRecipe({ reference }),
				{ mergeFrom, mergeInto },
			);
			const source = subjects.find(({ id }) => id === mergeFrom);
			const target = subjects.find(({ id }) => id === mergeInto);
			if (!source || !target) {
				return { output: { kind: "missing" } as const };
			}
			if (source.kind !== target.kind) {
				return { output: { kind: "kind-mismatch" } as const };
			}
			const links = yield* readAllRyotqlPages((after) =>
				executeRyotqlRecipe(
					host.executeRyotql,
					exerciseMergeLinksRecipe({ reference }),
					{ mergeFrom },
					{ pages: { links: { after } } },
				),
			);
			const templates = yield* readAllRyotqlPages((after) =>
				executeRyotqlRecipe(
					host.executeRyotql,
					exerciseMergeTemplatesRecipe({ reference }),
					{},
					{ pages: { templates: { after } } },
				),
			);
			const updates = templates.flatMap((template) => {
				const properties = swapTemplateExercise(template.properties, mergeFrom, mergeInto);
				return properties === null
					? []
					: [
							{
								properties,
								name: template.name,
								entitySchemaSlug: "workout-template",
								target: entityUpdateTarget(template),
							},
						];
			});
			if (updates.length > CHANGE_SET_LIMITS.entityUpdates) {
				return yield* new OperationRejectedError({
					reason: catalogMessage("rejection.exercise-merge.too-many-templates"),
				});
			}
			return {
				output: { mergeInto, kind: "merged" } as const,
				changes: {
					entities: { updates, merges: [{ mergeFrom, mergeInto, entitySchemaSlug: "exercise" }] },
					relationships: {
						deletes: links.map((link) => ({
							source: existingEntity(mergeFrom),
							relationshipSchemaSlug: link.slug,
							target: existingEntity(link.targetEntityId),
						})),
					},
				},
			};
		}),
});
