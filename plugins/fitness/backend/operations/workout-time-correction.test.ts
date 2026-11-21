import { expect, it } from "bun:test";

import type { ChangeSet } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";

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
	properties: { targets: [], equipment: [], exerciseOrder: 0, exerciseKind: "reps_and_weight" },
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
			const commands: ChangeSet[] = [];
			const host = defineSandboxTestHost(manifest, {
				executeRyotql: (document) =>
					Effect.succeed({
						data: Object.fromEntries(
							Object.keys(bindTestRequest(document).queries).map((key) => [key, responses[key]]),
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
				const result = yield* definition.run(input, host);
				expect(result.output).toEqual<unknown>({ entityId: "workout-1" });
				commands.push(result.changes);
			}
			expect(commands.map(({ entity }) => entity?.properties)).toEqual([
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
				baselines: [{ revision: 3, entityId: workoutId }],
				changes: [
					{
						kind: "update",
						itemIdentity: "update:occurrence-0",
						item: {
							eventId: "occurrence-0",
							expected: { occurredAt: time },
							patch: { occurredAt: corrected },
						},
					},
				],
			});
			expect(commands[0]?.events?.changes).toHaveLength(1);
		}),
	));

it("leaves a vanished workout to the commit's update target and refuses an unreadable token", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const host = defineSandboxTestHost(manifest, {
				executeRyotql: (document) =>
					Effect.succeed({
						data: Object.fromEntries(
							Object.keys(bindTestRequest(document).queries).map((key) => [
								key,
								key === "entity" ? rows([]) : responses[key],
							]),
						),
					}),
			});
			const input = yield* Schema.decodeEffect(WorkoutTimeCorrectionInputSchema)({
				submittedAt: time,
				startedAt: corrected,
				entityId: "workout-1",
				submissionId: "correction-1",
				activeDuration: { kind: "preserve" },
				conflictToken: yield* Effect.fromResult(encodeWorkoutEditorBaseline(baseline)),
			});
			expect(yield* definition.run(input, host)).toMatchObject({
				changes: { entity: { target: { kind: "update", entityId: "workout-1" } } },
			});
			expect(
				yield* Effect.flip(definition.run({ ...input, conflictToken: "garbage" }, host)),
			).toMatchObject({
				_tag: "OperationRejectedError",
				reason: { key: "rejection.workout-time.invalid" },
			});
		}),
	));
