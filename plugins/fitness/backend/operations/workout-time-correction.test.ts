import type { UserCommandInput } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { expect, it } from "vitest";

import type { WorkoutEditorBaselineSchema } from "../../shared/workout-editor-recipes";
import { encodeWorkoutEditorBaseline } from "../../shared/workout-editor-recipes";
import { WorkoutTimeCorrectionInputSchema } from "../../shared/workout-time-operations";
import definition, { manifest } from "./workout-time-correction.sandbox";

const time = "2026-10-01T10:00:00.000Z";
const corrected = "2026-10-01T09:00:00.000Z";
const workoutId = EntityId.make("workout-1");
const baseline: typeof WorkoutEditorBaselineSchema.Type = {
	sets: [],
	entity: {
		id: workoutId,
		name: "Workout",
		updatedAt: time,
		properties: {
			startedAt: time,
			activeDuration: 1200,
			images: [{ type: "s3", key: "keep.jpg" }],
		},
	},
};
const occurrence = (id: string, occurredAt: string) => ({
	id,
	occurredAt,
	entityId: "exercise-1",
	sessionEntityId: workoutId,
	properties: {
		targets: [],
		equipment: [],
		exerciseOrder: 0,
		provenance: "recorded",
		exerciseKind: "reps_and_weight",
	},
});
const rows = (items: readonly unknown[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});
const responses: Record<string, ReturnType<typeof rows>> = {
	scope: rows([{ revision: 3 }]),
	entity: rows([baseline.entity]),
	occurrences: rows([occurrence("occurrence-0", time), occurrence("occurrence-1", corrected)]),
};

it("changes only workout times, moves occurrences to the new start, and sets or clears duration", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const commands: UserCommandInput[] = [];
			const host = defineSandboxTestHost(manifest, {
				commitUserChanges: (command) =>
					Effect.sync(() => {
						commands.push(command);
						return { events: [], entityId: workoutId };
					}),
				executeRyotql: (document) =>
					Effect.succeed({
						data: Object.fromEntries(
							Object.keys(document.queries).map((key) => [key, responses[key]]),
						),
					}),
			});
			for (const activeDuration of [
				{ kind: "preserve" },
				{ seconds: 0, kind: "set" },
				{ kind: "clear" },
			] as const) {
				const input = yield* Schema.decodeEffect(WorkoutTimeCorrectionInputSchema)({
					endedAt: time,
					activeDuration,
					submittedAt: time,
					startedAt: corrected,
					entityId: "workout-1",
					submissionId: "correction-1",
					conflictToken: yield* Effect.fromResult(encodeWorkoutEditorBaseline(baseline)),
				});
				expect(yield* definition.run(input, host)).toEqual({
					kind: "saved",
					entityId: "workout-1",
				});
			}
			expect(commands.map(({ entity }) => entity.properties)).toEqual([
				{
					endedAt: time,
					activeDuration: 1200,
					startedAt: corrected,
					images: [{ type: "s3", key: "keep.jpg" }],
				},
				{
					endedAt: time,
					activeDuration: 0,
					startedAt: corrected,
					images: [{ type: "s3", key: "keep.jpg" }],
				},
				{ endedAt: time, startedAt: corrected, images: [{ type: "s3", key: "keep.jpg" }] },
			]);
			expect(commands[0]?.events).toMatchObject({
				creates: [],
				baselines: [{ revision: 3, entityId: workoutId }],
				changes: [
					{
						kind: "update",
						item: {
							eventId: "occurrence-0",
							expected: { occurredAt: time },
							patch: { occurredAt: corrected },
						},
					},
				],
			});
			expect(commands[0]?.events.changes).toHaveLength(1);
		}),
	));
