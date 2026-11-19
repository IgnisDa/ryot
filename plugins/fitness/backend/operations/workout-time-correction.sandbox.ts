import { updateEventChange } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, OperationConflictError } from "@ryot-app/plugin-backend-sdk/operation";
import {
	continuationCursor,
	entityEventScopeRevisionRecipe,
	executeRyotqlRecipe,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { Recipe } from "@ryot-app/plugin-kit/ryotql";
import { EventId } from "@ryot-app/plugin-kit/schema";

import { applyWorkoutTimes } from "../../shared/workout-editor-properties";
import {
	decodeWorkoutEditorBaseline,
	workoutEditorEntityRecipe,
} from "../../shared/workout-editor-recipes";
import { workoutOccurrencesRecipe } from "../../shared/workout-taxonomy-recipes";
import {
	WorkoutTimeCorrectionInputSchema,
	WorkoutTimeCorrectionOutputSchema,
} from "../../shared/workout-time-operations";

export const manifest = defineManifest({
	kind: "operation",
	name: "Correct workout times",
	slug: "operation.workout-time-correction",
});
type Occurrence = Recipe.Success<ReturnType<typeof workoutOccurrencesRecipe>>["items"][number];
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
				return { output: { kind: "invalid" } as const };
			}
			const current = yield* executeRyotqlRecipe(
				host.executeRyotql,
				workoutEditorEntityRecipe({ reference: { kind: "self" } }),
				{ kind: "workout", entityId: input.entityId },
			);
			if (!current) {
				return yield* new OperationConflictError({ conflict: "entity-not-found" });
			}
			const revision = yield* executeRyotqlRecipe(
				host.executeRyotql,
				entityEventScopeRevisionRecipe,
				{ entityId: input.entityId },
			);
			const occurrences: Occurrence[] = [];
			let after: string | undefined;
			do {
				const page = yield* executeRyotqlRecipe(
					host.executeRyotql,
					workoutOccurrencesRecipe({ reference: { kind: "self" } }),
					{ workoutId: input.entityId },
					{ pages: { occurrences: { after: after } } },
				);
				occurrences.push(...page.items);
				after = yield* continuationCursor(page.pageInfo, after);
			} while (after !== undefined);
			const { entity } = decoded.success;
			return {
				output: { kind: "saved", entityId: input.entityId } as const,
				changes: {
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
							.map((occurrence) =>
								updateEventChange(
									EventId.make(occurrence.id),
									{ occurredAt: input.startedAt },
									{
										kind: "fields",
										absentProperties: [],
										entityId: occurrence.entityId,
										occurredAt: occurrence.occurredAt,
										properties: occurrence.properties,
										sessionEntityId: occurrence.sessionEntityId,
									},
								),
							),
					},
				},
			};
		}),
});
