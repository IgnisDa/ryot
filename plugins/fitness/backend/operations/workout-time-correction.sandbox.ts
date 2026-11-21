import {
	entityUpdateTarget,
	expectedEventFields,
	updateEventChange,
} from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";
import {
	continuationCursor,
	entityEventScopeRevisionRecipe,
	executeRyotqlRecipe,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { Recipe } from "@ryot-app/plugin-kit/ryotql";
import { EventId } from "@ryot-app/plugin-kit/schema";

import { catalogMessage } from "../../shared/messages.generated";
import { applyWorkoutTimes } from "../../shared/workout-editor-properties";
import { decodeWorkoutEditorBaseline } from "../../shared/workout-editor-recipes";
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
				return yield* new OperationRejectedError({
					reason: catalogMessage("rejection.workout-time.invalid"),
				});
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
				output: { entityId: input.entityId },
				changes: {
					entity: {
						name: entity.name,
						entitySchemaSlug: "workout",
						target: entityUpdateTarget(entity),
						properties: applyWorkoutTimes(entity.properties, input),
					},
					events: {
						baselines: [{ revision, entityId: input.entityId }],
						changes: occurrences
							.filter(({ occurredAt }) => Date.parse(occurredAt) !== Date.parse(input.startedAt))
							.map((occurrence) =>
								updateEventChange(
									EventId.make(occurrence.id),
									{ occurredAt: input.startedAt },
									expectedEventFields(occurrence),
								),
							),
					},
				},
			};
		}),
});
