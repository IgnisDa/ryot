import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createEventFixture,
	listEventSchemas,
	listEventsForEntity,
	requireEventSchemaBySlug,
	waitForEventCount,
} from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	createExerciseNote,
	deleteExerciseNote,
	findWorkoutSetEventSchema,
	saveWorkoutData,
	updateExerciseNote,
	workoutData,
	workoutOccurrence,
	workoutSet,
} from "~/fixtures/plugins/fitness";
import { findMediaEntitySchema, seedMediaEntity } from "~/fixtures/plugins/media";
import { assertCondition, assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const listReviews = (client: Client, entityId: string) =>
	listEventsForEntity(client, entityId, undefined, 100, { eventSchemaSlug: "review" });

const expectRejected = (operation: ReturnType<typeof createExerciseNote>, message: string) =>
	Effect.gen(function* () {
		const failure = yield* Effect.flip(operation);
		assertTaggedError(failure, "PluginInvocationError");
		expect(failure.reason).toMatchObject({
			code: "runtime-failed",
			diagnostics: [{ severity: "error", message: expect.stringContaining(message) }],
		});
	});

const seedMovieWithReview = (client: Client) =>
	Effect.gen(function* () {
		const { schema } = yield* findMediaEntitySchema(client, "movie");
		const movie = yield* seedMediaEntity({
			properties: {},
			providerId: null,
			entitySchemaSlug: schema.id,
			name: "Exercise note movie",
			externalId: `exercise-note-movie-${crypto.randomUUID()}`,
		});
		const review = requireEventSchemaBySlug(
			yield* listEventSchemas(client, schema.reference),
			"review",
		);
		yield* createEventFixture(client, {
			entityId: movie.id,
			eventSchemaSlug: review.id,
			properties: { rating: 80, text: "Media review" },
		});
		const [event] = yield* listReviews(client, movie.id);
		return { movieId: movie.id, reviewEvent: requirePresent(event, "Expected media review") };
	});

describe("Fitness exercise notes", () => {
	it.live("creates, updates, and deletes private notes newest first", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId } = yield* createExerciseEntityFixture(client);

			expect(
				yield* createExerciseNote(client, { exerciseId, rating: 60, text: "First note" }),
			).toEqual({ count: 1 });
			yield* createExerciseNote(client, { exerciseId, text: "Second note" });

			const created = yield* waitForEventCount(client, exerciseId, 2);
			expect(created.map(({ properties }) => properties)).toEqual([
				{ text: "Second note" },
				{ rating: 60, text: "First note" },
			]);
			const first = requirePresent(created[1], "Expected the first note");

			yield* updateExerciseNote(client, { rating: 40, text: "Heavier", noteId: first.id });
			const rated = (yield* listReviews(client, exerciseId)).find(({ id }) => id === first.id);
			expect(rated?.properties).toEqual({ rating: 40, text: "Heavier" });
			expect(rated?.occurredAt).toBe(first.occurredAt);

			yield* updateExerciseNote(client, { rating: null, text: "Unrated", noteId: first.id });
			const unrated = (yield* listReviews(client, exerciseId)).find(({ id }) => id === first.id);
			expect(unrated?.properties).toEqual({ text: "Unrated" });

			expect(yield* deleteExerciseNote(client, { noteId: first.id })).toEqual({ count: 1 });
			expect((yield* listReviews(client, exerciseId)).map(({ properties }) => properties)).toEqual([
				{ text: "Second note" },
			]);
		}),
	);

	it.live("rejects another user's note without changing it", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { client: otherClient } = yield* createAuthenticatedClient();
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			yield* createExerciseNote(client, { exerciseId, rating: 20, text: "Mine" });
			const [note] = yield* waitForEventCount(client, exerciseId, 1);
			const noteId = requirePresent(note, "Expected a note").id;

			yield* expectRejected(
				updateExerciseNote(otherClient, { noteId, rating: null, text: "Theirs" }),
				"Exercise note not found",
			);
			yield* expectRejected(deleteExerciseNote(otherClient, { noteId }), "Exercise note not found");

			expect((yield* listReviews(client, exerciseId)).map(({ properties }) => properties)).toEqual([
				{ rating: 20, text: "Mine" },
			]);
		}),
	);

	it.live("rejects workout-set and media review ids without changing them", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
			const workout = yield* saveWorkoutData(
				client,
				workoutData({
					occurrences: [
						workoutOccurrence(exerciseId, [workoutSet({ measurements: { reps: 5, weight: 50 } })]),
					],
				}),
			);
			assertCondition(workout.kind === "saved", "Expected the note fixture workout to save");
			expect(workout.sets).toHaveLength(1);
			const workoutEvents = yield* listEventsForEntity(client, exerciseId, undefined, 100);
			const workoutSetEvent = requirePresent(
				workoutEvents.find(({ eventSchemaSlug }) => eventSchemaSlug === workoutSetEventSchema.id),
				"Expected a workout set",
			);
			const { movieId, reviewEvent } = yield* seedMovieWithReview(client);

			for (const noteId of [workoutSetEvent.id, reviewEvent.id]) {
				yield* expectRejected(
					updateExerciseNote(client, { noteId, rating: null, text: "Hijacked" }),
					"Exercise note not found",
				);
				yield* expectRejected(deleteExerciseNote(client, { noteId }), "Exercise note not found");
			}

			const storedWorkoutSet = requirePresent(
				(yield* listEventsForEntity(client, exerciseId, undefined, 100)).find(
					({ eventSchemaSlug }) => eventSchemaSlug === workoutSetEventSchema.id,
				),
				"Expected the workout set to remain unchanged",
			);
			expect(storedWorkoutSet.id).toBe(workoutSetEvent.id);
			expect(storedWorkoutSet.properties).toMatchObject({ reps: 5, weight: 50 });
			expect(storedWorkoutSet.properties).not.toHaveProperty("text");
			expect(yield* listReviews(client, movieId)).toEqual([reviewEvent]);
		}),
	);

	it.live("rejects creating notes on media entities and another user's exercise", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { client: otherClient } = yield* createAuthenticatedClient();
			const { exerciseId: otherExerciseId } = yield* createExerciseEntityFixture(otherClient);
			const { schema } = yield* findMediaEntitySchema(client, "movie");
			const movie = yield* seedMediaEntity({
				properties: {},
				providerId: null,
				entitySchemaSlug: schema.id,
				name: "Exercise note target movie",
				externalId: `exercise-note-target-${crypto.randomUUID()}`,
			});

			yield* expectRejected(
				createExerciseNote(client, { exerciseId: movie.id, text: "Not an exercise" }),
				"Exercise not found",
			);
			yield* expectRejected(
				createExerciseNote(client, { text: "Not mine", exerciseId: otherExerciseId }),
				"Exercise not found",
			);

			expect(yield* listEventsForEntity(client, movie.id, undefined, 100)).toEqual([]);
			expect(yield* listEventsForEntity(otherClient, otherExerciseId, undefined, 100)).toEqual([]);
		}),
	);
});
