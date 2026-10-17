import { exerciseTargetsRecipe } from "@ryot-app/fitness-plugin/taxonomy-recipes";
import { workoutExercisePickerRecipe } from "@ryot-app/fitness-plugin/workout-exercise-recipes";
import {
	workoutExercisePreviousValuesRecipe,
	workoutHistoryRecipe,
	workoutHistorySetsRecipe,
} from "@ryot-app/fitness-plugin/workout-history-recipes";
import { Effect } from "effect";

import { createAuthenticatedClient, executeRyotQLRecipe } from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	findFitnessEntitySchema,
	saveWorkoutEditor,
	updateExerciseOverrides,
} from "~/fixtures/plugins/fitness";
import { assertCondition } from "~/support/assertions";
import { expect, it } from "~/support/effect-test";

it.live(
	"reads the scoped library and Previous values across repeated occurrences and older sessions",
	() =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId } = yield* createExerciseEntityFixture(client, {
				name: "Editor Bench",
				kind: "reps_and_weight",
			});
			yield* createExerciseEntityFixture(client, { kind: "duration", name: "Editor Timer" });
			expect(
				yield* updateExerciseOverrides(client, {
					exerciseId,
					remove: [],
					set: { normalRestTime: 0 },
				}),
			).toEqual({ kind: "saved" });
			const { pluginId } = yield* findFitnessEntitySchema(client, "workout");
			const reference = { pluginId, kind: "local" as const };
			const selected = yield* executeRyotQLRecipe(
				client,
				workoutExercisePickerRecipe({
					reference,
					search: "EDITOR",
					sort: "recently-added",
					kinds: ["reps_and_weight"],
				}),
			);
			expect(selected.items).toMatchObject([
				{
					id: exerciseId,
					name: "Editor Bench",
					kind: "reps_and_weight",
					membershipProperties: { normalRestTime: 0 },
				},
			]);
			expect(
				(yield* executeRyotQLRecipe(
					client,
					exerciseTargetsRecipe({ reference, exerciseId, limit: 100 }),
				)).items,
			).toEqual([]);
			for (const [day, weights] of [
				["2026-10-01", [20]],
				["2026-10-02", [30, 40]],
			] as const) {
				const timestamp = `${day}T10:00:00.000Z`;
				const saved = yield* saveWorkoutEditor(client, {
					submittedAt: timestamp,
					submissionId: crypto.randomUUID(),
					data: {
						images: [],
						videos: [],
						supersets: [],
						kind: "workout",
						startedAt: timestamp,
						name: `Session ${day}`,
						target: { kind: "create" },
						activeDuration: { kind: "preserve" },
						occurrences: weights.map((weight, index) => ({
							notes: [],
							exerciseId,
							images: [],
							videos: [],
							clientId: `occurrence-${index}`,
							sets: [
								{
									setLot: "normal",
									occurredAt: timestamp,
									confirmedAt: timestamp,
									clientId: `set-${index}`,
									exerciseKind: "reps_and_weight",
									measurements: { weight, reps: 5 },
								},
							],
						})),
					},
				});
				assertCondition(saved.kind === "saved", "Expected a saved workout");
			}
			const history = yield* executeRyotQLRecipe(
				client,
				workoutHistoryRecipe({
					reference,
					exerciseId,
					beforeStartedAt: "2026-10-03T10:00:00.000Z",
				}),
			);
			expect(history.items.map(({ name }) => name)).toEqual([
				"Session 2026-10-02",
				"Session 2026-10-01",
			]);
			const latest = history.items[0];
			assertCondition(latest !== undefined, "Expected the latest session");
			const sets = yield* executeRyotQLRecipe(
				client,
				workoutHistorySetsRecipe({ reference, exerciseId, workoutId: latest.id }),
			);
			expect(sets.items.map(({ weight, exerciseOrder }) => ({ weight, exerciseOrder }))).toEqual([
				{ weight: 30, exerciseOrder: 0 },
				{ weight: 40, exerciseOrder: 1 },
			]);
			const previous = yield* executeRyotQLRecipe(
				client,
				workoutExercisePreviousValuesRecipe({
					reference,
					exerciseId,
					recordedKind: "reps_and_weight",
					excludeWorkoutId: "current-draft",
					beforeStartedAt: "2026-10-03T10:00:00.000Z",
				}),
			);
			expect(previous.items.map(({ weight }) => weight)).toEqual([30, 40, 20]);
			const excluded = yield* executeRyotQLRecipe(
				client,
				workoutExercisePreviousValuesRecipe({
					reference,
					exerciseId,
					excludeWorkoutId: latest.id,
					recordedKind: "reps_and_weight",
					beforeStartedAt: "2026-10-03T10:00:00.000Z",
				}),
			);
			expect(excluded.items.map(({ weight }) => weight)).toEqual([20]);
		}),
);
