import { exerciseDetailsRecipe } from "@ryot-app/fitness-plugin/exercise-details-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	getEntity,
	pollUntil,
} from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import {
	createExerciseEntityFixture,
	createExerciseNote,
	readWorkoutDetails,
	seedExerciseWorkout,
} from "~/fixtures/plugins/fitness";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const timeZone = "Pacific/Auckland";
type FitnessReference = Parameters<typeof exerciseDetailsRecipe>[0]["reference"];

const exerciseDetails = (client: Client, exerciseId: string) =>
	Effect.gen(function* () {
		const exercise = yield* getEntity(client, exerciseId);
		const pluginId = requirePresent(
			exercise.entitySchemaPluginId,
			"Expected a Fitness exercise owner",
		);
		const reference: FitnessReference = { pluginId, kind: "local" };
		return yield* executeRyotQLRecipe(
			client,
			exerciseDetailsRecipe({ timeZone, reference, exerciseId }),
		);
	});

const waitForReadySets = (client: Client, workoutId: string) =>
	pollUntil(
		`ready workout sets for ${workoutId}`,
		Effect.gen(function* () {
			const workout = yield* readWorkoutDetails(client, workoutId);
			const sets = workout.exercises.items.flatMap((exercise) => exercise.sets.items);
			return sets.length > 0 && sets.every((set) => set.recordStatus === "ready") ? sets : null;
		}),
	);

describe("Exercise details recipe E2E", () => {
	it.live("summarizes a performed exercise and returns empty history for an unperformed one", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId } = yield* createExerciseEntityFixture(client, { name: "Details bench" });
			const { exerciseId: unperformedId } = yield* createExerciseEntityFixture(client, {
				kind: "reps",
			});

			const { workoutId: olderId } = yield* seedExerciseWorkout(client, {
				exerciseId,
				name: "Push day",
				endedAt: "2026-05-31T14:00:00.000Z",
				startedAt: "2026-05-31T13:00:00.000Z",
				exerciseNotes: [{ exerciseOrder: 0, notes: ["Left shoulder tight"] }],
				sets: [
					{
						occurredAt: "2026-05-31T13:00:00.000Z",
						properties: { reps: 10, weight: 20, setLot: "warm_up" },
					},
					{
						occurredAt: "2026-05-31T13:05:00.000Z",
						properties: { reps: 5, weight: 100, note: "Felt heavy" },
					},
				],
			});
			const { workoutId: newerId } = yield* seedExerciseWorkout(client, {
				exerciseId,
				name: "Push day",
				endedAt: "2026-06-30T14:00:00.000Z",
				startedAt: "2026-06-30T13:00:00.000Z",
				sets: [
					{ properties: { reps: 8, weight: 90 }, occurredAt: "2026-06-30T13:00:00.000Z" },
					{
						occurredAt: "2026-06-30T13:05:00.000Z",
						properties: { reps: 3, weight: 120, setLot: "failure" },
					},
				],
			});
			yield* waitForReadySets(client, olderId);
			yield* waitForReadySets(client, newerId);
			yield* createExerciseNote(client, { exerciseId, text: "First note" });
			yield* createExerciseNote(client, { exerciseId, rating: 80, text: "Second note" });

			const details = yield* exerciseDetails(client, exerciseId);

			expect(details.exercise).toMatchObject({
				id: exerciseId,
				name: "Details bench",
				kind: "reps_and_weight",
				userId: expect.any(String),
			});
			expect(details.totals).toMatchObject({
				sets: 4,
				reps: 26,
				sessions: 2,
				warmUpSets: 1,
				failureSets: 1,
				weightForReps8: 90,
				weightForReps1: 120,
				weightForReps5: 100,
				weightForReps12: null,
				weightForReps30: null,
			});
			expect(details.months.map((month) => month.month)).toEqual([
				"2026-05-31T12:00:00.000Z",
				"2026-06-30T12:00:00.000Z",
			]);
			expect(details.months[0]).toMatchObject({ reps: 15, sessions: 1, maxWeight: 100 });
			expect(details.months[1]).toMatchObject({ maxReps: 8, sessions: 1, maxWeight: 120 });
			expect(details.topWorkout).toEqual({ sessions: 2, name: "Push day" });

			expect(details.sessions.map((session) => session.id)).toEqual([newerId, olderId]);
			expect(details.sessions[1]?.sets.items.map((set) => [set.setLot, set.reps])).toEqual([
				["warm_up", 10],
				[null, 5],
			]);

			expect(details.personalBests.length).toBeGreaterThan(0);
			expect(
				details.personalBests.every(
					(row, index) =>
						index === 0 || (details.personalBests[index - 1]?.occurredAt ?? "") >= row.occurredAt,
				),
			).toBe(true);
			expect(details.personalBests[0]).toMatchObject({ weight: 120, workoutId: newerId });
			expect(details.personalBests[0]?.personalBests).toContain("weight");

			expect(details.setNotes).toMatchObject([{ note: "Felt heavy", workoutId: olderId }]);
			expect(details.workoutNotes).toMatchObject([
				{
					id: olderId,
					exerciseOrder: 0,
					exerciseNotes: [{ exerciseOrder: 0, notes: ["Left shoulder tight"] }],
				},
			]);
			expect(details.notes.map((note) => [note.text, note.rating])).toEqual([
				["Second note", 80],
				["First note", null],
			]);

			const empty = yield* exerciseDetails(client, unperformedId);
			expect(empty.exercise).toMatchObject({ kind: "reps", id: unperformedId });
			expect(empty.totals).toMatchObject({
				sets: 0,
				reps: null,
				sessions: 0,
				lastAt: null,
				firstAt: null,
				weightForReps1: null,
			});
			expect(empty).toMatchObject({
				notes: [],
				months: [],
				sessions: [],
				setNotes: [],
				topWorkout: null,
				workoutNotes: [],
				personalBests: [],
			});
		}),
	);
});
