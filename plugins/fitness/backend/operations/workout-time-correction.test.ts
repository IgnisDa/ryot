import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { expect, it } from "vitest";

import {
	encodeWorkoutEditorBaseline,
	WorkoutEditorBaselineSchema,
} from "../../shared/workout-editor-recipes";
import { WorkoutTimeCorrectionInputSchema } from "../../shared/workout-time-operations";
import definition, { manifest } from "./workout-time-correction.sandbox";

const time = "2026-10-01T10:00:00.000Z";
const baseline = Schema.decodeSync(WorkoutEditorBaselineSchema)({
	sets: [],
	entity: {
		id: "workout-1",
		name: "Workout",
		updatedAt: time,
		properties: {
			startedAt: time,
			activeDuration: 1200,
			images: [{ type: "s3", key: "keep.jpg" }],
		},
	},
});

it("changes only workout times and explicitly sets or clears recorded duration", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const writes: unknown[] = [];
			const host = defineSandboxTestHost(manifest, {
				updateUserEntity: (item) =>
					Effect.sync(() => {
						writes.push(item.properties);
						return { entityId: item.entityId };
					}),
				executeRyotql: () =>
					Effect.succeed({
						data: {
							entity: {
								type: "rows",
								items: [baseline.entity],
								pageInfo: { limit: 2, hasMore: false, nextCursor: null },
							},
						},
					}),
			});
			for (const activeDuration of [
				{ kind: "preserve" },
				{ seconds: 0, kind: "set" },
				{ kind: "clear" },
			] as const) {
				const input = yield* Schema.decodeEffect(WorkoutTimeCorrectionInputSchema)({
					activeDuration,
					submittedAt: time,
					entityId: "workout-1",
					submissionId: "correction-1",
					endedAt: "2026-10-01T10:00:00.000Z",
					startedAt: "2026-10-01T09:00:00.000Z",
					conflictToken: encodeWorkoutEditorBaseline(baseline),
				});
				expect(yield* definition.run(input, host)).toEqual({
					kind: "saved",
					entityId: "workout-1",
				});
			}
			expect(writes).toEqual([
				{
					endedAt: time,
					activeDuration: 1200,
					startedAt: "2026-10-01T09:00:00.000Z",
					images: [{ type: "s3", key: "keep.jpg" }],
				},
				{
					endedAt: time,
					activeDuration: 0,
					startedAt: "2026-10-01T09:00:00.000Z",
					images: [{ type: "s3", key: "keep.jpg" }],
				},
				{
					endedAt: time,
					startedAt: "2026-10-01T09:00:00.000Z",
					images: [{ type: "s3", key: "keep.jpg" }],
				},
			]);
		}),
	));
