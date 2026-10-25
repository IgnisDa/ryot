import { isCommitConflict, userCommandInputSchema } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { continuationCursor, executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";
import type { Recipe } from "@ryot-app/plugin-kit/ryotql";

import { applyWorkoutTimes } from "../../shared/workout-editor-properties";
import {
	decodeWorkoutEditorBaseline,
	workoutEditorEntityRecipe,
} from "../../shared/workout-editor-recipes";
import {
	workoutEventScopeRevisionRecipe,
	workoutOccurrencesRecipe,
} from "../../shared/workout-taxonomy-recipes";
import {
	WorkoutTimeCorrectionInputSchema,
	WorkoutTimeCorrectionOutputSchema,
} from "../../shared/workout-time-operations";

export const manifest = defineManifest({
	kind: "operation",
	name: "Correct workout times",
	slug: "operation.workout-time-correction",
});

type Occurrence = Recipe.Success<typeof workoutOccurrencesRecipe>["items"][number];

export default defineOperation({
	manifest,
	input: WorkoutTimeCorrectionInputSchema,
	output: WorkoutTimeCorrectionOutputSchema,
	run: (input, host) =>
		Effect.gen(function* () {
			const decoded = decodeWorkoutEditorBaseline(input.conflictToken);
			if (
				decoded._tag === "Failure" ||
				decoded.success.entity.id !== input.entityId ||
				(input.endedAt !== undefined && Date.parse(input.endedAt) < Date.parse(input.startedAt))
			) {
				return { kind: "invalid" } as const;
			}
			const current = yield* executeRyotqlRecipe(
				host.executeRyotql,
				workoutEditorEntityRecipe({
					kind: "workout",
					entityId: input.entityId,
					reference: { kind: "self" },
				}),
			);
			if (!current) {
				return { kind: "conflict" } as const;
			}
			const revision = yield* executeRyotqlRecipe(
				host.executeRyotql,
				workoutEventScopeRevisionRecipe(input.entityId),
			);
			const occurrences: Occurrence[] = [];
			let after: string | undefined;
			do {
				const page = yield* executeRyotqlRecipe(
					host.executeRyotql,
					workoutOccurrencesRecipe({
						after,
						workoutId: input.entityId,
						reference: { kind: "self" },
					}),
				);
				occurrences.push(...page.items);
				after = yield* continuationCursor(page.pageInfo, after);
			} while (after !== undefined);
			const { entity } = decoded.success;
			const command = yield* Schema.decodeUnknownEffect(userCommandInputSchema)({
				relationships: [],
				entity: {
					name: entity.name,
					entitySchemaSlug: "workout",
					properties: applyWorkoutTimes(entity.properties, input),
					target: {
						kind: "update",
						entityId: input.entityId,
						expected: {
							name: entity.name,
							updatedAt: entity.updatedAt,
							properties: entity.properties,
						},
					},
				},
				events: {
					creates: [],
					baselines: [{ revision, entityId: input.entityId }],
					changes: occurrences
						.filter(({ occurredAt }) => Date.parse(occurredAt) !== Date.parse(input.startedAt))
						.map((occurrence) => ({
							kind: "update",
							itemIdentity: `occurrence-update:${occurrence.id}`,
							item: {
								eventId: occurrence.id,
								patch: { occurredAt: input.startedAt },
								expected: {
									kind: "fields",
									absentProperties: [],
									entityId: occurrence.entityId,
									occurredAt: occurrence.occurredAt,
									properties: occurrence.properties,
									sessionEntityId: occurrence.sessionEntityId,
								},
							},
						})),
				},
			}).pipe(Effect.orDie);
			const saved = yield* host
				.commitUserChanges(command, {
					submittedAt: input.submittedAt,
					idempotencyKey: input.submissionId,
				})
				.pipe(
					Effect.as(true),
					Effect.catchIf(isCommitConflict, () => Effect.succeed(false)),
				);
			return saved
				? ({ kind: "saved", entityId: input.entityId } as const)
				: ({ kind: "conflict" } as const);
		}),
});
