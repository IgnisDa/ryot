import type { ChangeUserRelationshipBatch } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import {
	ExerciseMergeInputSchema,
	ExerciseMergeOutputSchema,
} from "../../shared/exercise-merge-operations";
import {
	exerciseMergeLinksRecipe,
	exerciseMergeSubjectsRecipe,
	exerciseMergeTemplatesRecipe,
} from "../../shared/exercise-merge-recipes";
import { WorkoutEditorPropertiesSchema } from "../../shared/workout-editor-recipes";

export const manifest = defineManifest({
	kind: "operation",
	name: "Merge exercise",
	slug: "operation.exercise-merge",
});

const reference = { kind: "self" } as const;
const detachBatchSize = 100;

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

const loadAll = <Item, Error>(
	load: (
		after: string | undefined,
	) => Effect.Effect<
		{
			readonly items: ReadonlyArray<Item>;
			readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
		},
		Error
	>,
) =>
	Effect.gen(function* () {
		const items: Item[] = [];
		const cursors = new Set<string>();
		let after: string | undefined;
		let hasMore = true;
		while (hasMore) {
			const page = yield* load(after);
			items.push(...page.items);
			hasMore = page.pageInfo.hasMore;
			if (hasMore) {
				const cursor = page.pageInfo.nextCursor;
				if (cursor === null || cursors.has(cursor)) {
					return yield* Effect.die("Exercise merge pagination did not advance");
				}
				cursors.add(cursor);
				after = cursor;
			}
		}
		return items;
	});

export default defineOperation({
	manifest,
	input: ExerciseMergeInputSchema,
	output: ExerciseMergeOutputSchema,
	run: ({ mergeFrom, mergeInto }, host) =>
		Effect.gen(function* () {
			if (mergeFrom === mergeInto) {
				return { kind: "same" } as const;
			}
			const subjects = yield* executeRyotqlRecipe(
				host.executeRyotql,
				exerciseMergeSubjectsRecipe({ mergeFrom, mergeInto, reference }),
			);
			const source = subjects.find(({ id }) => id === mergeFrom);
			const target = subjects.find(({ id }) => id === mergeInto);
			if (!source || !target) {
				return { kind: "missing" } as const;
			}
			if (source.userId === null) {
				return { kind: "not-custom" } as const;
			}
			if (source.kind !== target.kind) {
				return { kind: "kind-mismatch" } as const;
			}

			const links = yield* loadAll((after) =>
				executeRyotqlRecipe(
					host.executeRyotql,
					exerciseMergeLinksRecipe({ after, mergeFrom, reference }),
				),
			);
			const batches: ChangeUserRelationshipBatch[] = [];
			for (let offset = 0; offset < links.length; offset += detachBatchSize) {
				batches.push({
					creates: [],
					deletes: links
						.slice(offset, offset + detachBatchSize)
						.map((link) => ({
							sourceEntityId: mergeFrom,
							relationshipSchemaSlug: link.slug,
							targetEntityId: link.targetEntityId,
						})),
				});
			}
			if (batches.length > 0) {
				yield* host.changeUserRelationships(batches);
			}

			yield* host.mergeUserEntityData({ mergeFrom, mergeInto, entitySchemaSlug: "exercise" });

			const templates = yield* loadAll((after) =>
				executeRyotqlRecipe(host.executeRyotql, exerciseMergeTemplatesRecipe({ after, reference })),
			);
			for (const template of templates) {
				const properties = swapTemplateExercise(template.properties, mergeFrom, mergeInto);
				if (properties === null) {
					continue;
				}
				yield* host.updateUserEntity({
					properties,
					name: template.name,
					entityId: template.id,
					expected: {
						name: template.name,
						updatedAt: template.updatedAt,
						properties: template.properties,
					},
				});
			}
			return { mergeInto, kind: "merged" } as const;
		}),
});
