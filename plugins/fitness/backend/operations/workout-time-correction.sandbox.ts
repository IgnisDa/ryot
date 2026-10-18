import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import { applyWorkoutTimes } from "../../shared/workout-editor-properties";
import {
	decodeWorkoutEditorBaseline,
	workoutEditorEntityRecipe,
} from "../../shared/workout-editor-recipes";
import {
	WorkoutTimeCorrectionInputSchema,
	WorkoutTimeCorrectionOutputSchema,
} from "../../shared/workout-time-operations";

export const manifest = defineManifest({
	kind: "operation",
	name: "Correct workout times",
	slug: "operation.workout-time-correction",
});

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
			const { entity } = decoded.success;
			const properties = applyWorkoutTimes(entity.properties, input);
			const saved = yield* host
				.updateUserEntity(
					{
						properties,
						name: entity.name,
						entityId: input.entityId,
						expected: {
							name: entity.name,
							updatedAt: entity.updatedAt,
							properties: entity.properties,
						},
					},
					{ submittedAt: input.submittedAt, idempotencyKey: input.submissionId },
				)
				.pipe(
					Effect.map(() => true),
					Effect.catch((error) => {
						const reason = Schema.decodeUnknownResult(Schema.Struct({ code: Schema.String }))(
							error.data,
						);
						return reason._tag === "Success" &&
							["entity-stale", "mutation-conflict"].includes(reason.success.code)
							? Effect.succeed(false)
							: Effect.fail(error);
					}),
				);
			return saved
				? ({ kind: "saved", entityId: input.entityId } as const)
				: ({ kind: "conflict" } as const);
		}),
});
