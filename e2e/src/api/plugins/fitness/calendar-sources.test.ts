import {
	calendarOccurrencesPageRecipe,
	calendarSourcesRecipe,
} from "@ryot-app/ryotql-recipes/calendar";
import { Effect, Result } from "effect";

import {
	type Client,
	collectRyotQLRecipeItems,
	createAuthenticatedClient,
	executeRyotQLRecipe,
} from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	createWorkoutTemplateEntityFixture,
	saveWorkoutData,
	workoutData,
	workoutOccurrence,
	workoutSet,
} from "~/fixtures/plugins/fitness";
import { assertCondition } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const window = {
	month: "2026-09",
	localEnd: "2026-10-01T00:00:00.000Z",
	localStart: "2026-09-01T00:00:00.000Z",
};

const occurrences = (client: Client) =>
	Effect.gen(function* () {
		const sources = yield* executeRyotQLRecipe(client, calendarSourcesRecipe());
		const source = sources.find((candidate) => candidate.slug === "workouts");
		if (source === undefined) {
			throw new Error("Missing calendar source 'workouts'");
		}
		return yield* collectRyotQLRecipeItems(client, (after) =>
			Result.getOrThrow(calendarOccurrencesPageRecipe({ after, source, window })),
		);
	});

const seedWorkout = (client: Client, startedAt: string, exerciseCount: number) =>
	Effect.gen(function* () {
		const exercises = yield* Effect.all(
			Array.from({ length: exerciseCount }, () => createExerciseEntityFixture(client)),
		);
		const created = yield* saveWorkoutData(
			client,
			workoutData({
				startedAt,
				endedAt: startedAt,
				occurrences: exercises.map(({ exerciseId }) =>
					workoutOccurrence(
						exerciseId,
						[0, 1].map(() =>
							workoutSet({
								occurredAt: startedAt,
								confirmedAt: startedAt,
								measurements: { reps: 5, weight: 50 },
							}),
						),
					),
				),
			}),
		);
		assertCondition(created.kind === "saved", "Expected the calendar workout to save");
		expect(created.sets).toHaveLength(exerciseCount * 2);
		return created.entityId;
	});

describe("Fitness calendar sources", () => {
	it.live("lists the user's workouts at their start instant with an exercise count", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { client: otherClient } = yield* createAuthenticatedClient();
			const [two, one] = yield* Effect.all([
				seedWorkout(client, "2026-09-10T08:15:00.000Z", 2),
				seedWorkout(client, "2026-09-12T18:30:00.000Z", 1),
			]);
			yield* seedWorkout(client, "2026-10-02T08:00:00.000Z", 1);
			yield* seedWorkout(client, "2026-08-31T08:00:00.000Z", 1);
			yield* seedWorkout(otherClient, "2026-09-11T08:00:00.000Z", 1);
			yield* createWorkoutTemplateEntityFixture(client);

			expect(
				(yield* occurrences(client)).map(({ caption, startAt, subject }) => ({
					caption,
					startAt,
					subject: subject.id,
				})),
			).toEqual([
				{ subject: two, caption: "2 exercises", startAt: "2026-09-10T08:15:00.000Z" },
				{ subject: one, caption: "1 exercise", startAt: "2026-09-12T18:30:00.000Z" },
			]);
		}),
	);
});
