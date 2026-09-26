import type { CreateEventsResponse } from "@ryot-app/contract/modules/events/schemas";
import { workoutDetailsRecipe } from "@ryot-app/fitness-plugin/workout-details-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	listEventsForEntity,
	pollUntil,
	waitForCreateEvents,
} from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import {
	createExerciseEntityFixture,
	createWorkoutEntityFixture,
	findWorkoutSetEventSchema,
} from "~/fixtures/plugins/fitness";
import { assertCondition, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const workoutDetails = (client: Client, workoutId: string) =>
	executeRyotQLRecipe(client, workoutDetailsRecipe({ workoutId })).pipe(
		Effect.map((workout) => requirePresent(workout, `Expected workout ${workoutId}`)),
	);

const waitForReadyWorkoutSets = (
	client: Client,
	workoutId: string,
	expectedCount: number,
	timeoutMs?: number,
) =>
	pollUntil(
		`${expectedCount} ready workout sets for ${workoutId}`,
		Effect.gen(function* () {
			const workout = yield* workoutDetails(client, workoutId);
			const items = workout.exercises.items.flatMap((exercise) => exercise.sets.items);
			assertCondition(
				!items.some((item) => item.recordStatus === "failed"),
				"Workout record processing failed",
			);
			return items.length === expectedCount && items.every((item) => item.recordStatus === "ready")
				? { items, workout }
				: null;
		}),
		timeoutMs,
	);

const isoString = (value: string | Date) => new Date(value).toISOString();

const storedWorkoutSet = (client: Client, exerciseId: string, eventId: string) =>
	listEventsForEntity(client, exerciseId, undefined, 100).pipe(
		Effect.map((events) =>
			requirePresent(
				events.find((event) => event.id === eventId),
				`Expected stored workout set ${eventId}`,
			),
		),
	);

const requireWorkoutSetEventId = (result: CreateEventsResponse, index = 0) => {
	const outcome = result.outcomes.find((item) => item.index === index);
	assertCondition(outcome?.status === "written", `Expected event ${index} to be written`);
	return outcome.eventId;
};

describe("Workout records E2E", () => {
	it.live("converts imperial workout-set measurements before rounding them", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const workoutStartedAt = "2026-06-02T10:00:00.000Z";
			const { workoutId } = yield* createWorkoutEntityFixture(client, {
				startedAt: workoutStartedAt,
				endedAt: "2026-06-02T11:00:00.000Z",
			});
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);

			const createResponse = yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: exerciseId,
							sessionEntityId: workoutId,
							occurredAt: workoutStartedAt,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: { reps: 10, weight: 10, setOrder: 0, exerciseOrder: 0 },
						},
					],
				}),
			);
			const createResult = yield* waitForCreateEvents(client, createResponse);
			expect(createResult.count).toBe(1);
			const eventId = requireWorkoutSetEventId(createResult);

			yield* waitForReadyWorkoutSets(client, workoutId, 1);

			yield* client.call((c) =>
				c.events.update({
					params: { eventId },
					payload: {
						properties: {
							remove: [],
							set: { weight: 100.0000012, unitSystem: "imperial", distance: 1.00000000049 },
						},
					},
				}),
			);

			const { items: updatedItems } = yield* waitForReadyWorkoutSets(client, workoutId, 1);
			const updatedSet = requirePresent(updatedItems[0], "Expected the updated workout set");
			expect(updatedSet.weight).toBe(45.359238);
			expect(updatedSet.distance).toBe(1.609344001);
			const storedSet = yield* storedWorkoutSet(client, exerciseId, eventId);
			expect(storedSet.properties["unitSystem"]).toBe("metric");
		}),
	);

	it.live("recomputes historical workout-set personal bests after insert, update, and delete", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const newerStartedAt = "2026-06-02T10:00:00.000Z";
			const newerConfirmedAt = "2026-06-02T10:05:00.000Z";
			const olderStartedAt = "2026-06-01T10:00:00.000Z";
			const { workoutId: newerWorkoutId } = yield* createWorkoutEntityFixture(client, {
				startedAt: newerStartedAt,
				endedAt: "2026-06-02T11:00:00.000Z",
			});
			const { workoutId: olderWorkoutId } = yield* createWorkoutEntityFixture(client, {
				startedAt: olderStartedAt,
				endedAt: "2026-06-01T11:00:00.000Z",
			});
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);

			const newerCreate = yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: exerciseId,
							occurredAt: newerStartedAt,
							sessionEntityId: newerWorkoutId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: {
								reps: 25,
								weight: 10,
								setOrder: 0,
								restTime: 45,
								exerciseOrder: 0,
								confirmedAt: newerConfirmedAt,
							},
						},
					],
				}),
			);
			const newerCreateResult = yield* waitForCreateEvents(client, newerCreate);
			expect(newerCreateResult.count).toBe(1);
			const newerEventId = requireWorkoutSetEventId(newerCreateResult);

			const { items: initialNewerItems } = yield* waitForReadyWorkoutSets(
				client,
				newerWorkoutId,
				1,
			);
			const initialNewerSet = requirePresent(
				initialNewerItems[0],
				"Expected the newer workout set",
			);
			expect(initialNewerSet).toMatchObject({
				volume: 250,
				restTime: 45,
				oneRm: 18.333333,
				recordStatus: "ready",
				confirmedAt: newerConfirmedAt,
				personalBests: ["reps", "one_rm", "volume", "weight"],
			});
			const storedNewerSet = yield* storedWorkoutSet(client, exerciseId, newerEventId);
			expect(isoString(storedNewerSet.occurredAt)).toBe(newerConfirmedAt);
			expect(storedNewerSet.properties["unitSystem"]).toBe("metric");

			const olderCreate = yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: exerciseId,
							occurredAt: olderStartedAt,
							sessionEntityId: olderWorkoutId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: { reps: 25, weight: 10, setOrder: 0, exerciseOrder: 0 },
						},
					],
				}),
			);
			const olderCreateResult = yield* waitForCreateEvents(client, olderCreate);
			expect(olderCreateResult.count).toBe(1);
			const olderEventId = requireWorkoutSetEventId(olderCreateResult);

			const { items: olderItems } = yield* waitForReadyWorkoutSets(client, olderWorkoutId, 1);
			const olderSet = requirePresent(olderItems[0], "Expected the older workout set");
			expect(olderSet).toMatchObject({
				restTime: null,
				confirmedAt: null,
				recordStatus: "ready",
				personalBests: ["reps", "one_rm", "volume", "weight"],
			});
			const storedOlderSet = yield* storedWorkoutSet(client, exerciseId, olderEventId);
			expect(isoString(storedOlderSet.occurredAt)).toBe(olderStartedAt);
			const insertedNewer = yield* waitForReadyWorkoutSets(client, newerWorkoutId, 1);
			const insertedNewerSet = requirePresent(
				insertedNewer.items[0],
				"Expected the newer workout set after historical insert",
			);
			expect(insertedNewerSet.personalBests).toEqual([]);
			const insertedNewerExercise = requirePresent(
				insertedNewer.workout.exercises.items[0],
				"Expected the newer workout exercise",
			);
			expect(
				isoString(
					requirePresent(
						insertedNewerExercise.previousWorkoutStartedAt,
						"Expected a previous session",
					),
				),
			).toBe(olderStartedAt);
			expect(insertedNewerExercise.previousSets.items.map((set) => set.reps)).toEqual([25]);

			yield* client.call((c) =>
				c.events.update({
					params: { eventId: olderEventId },
					payload: { properties: { remove: [], set: { reps: 20 } } },
				}),
			);
			const { items: editedOlderItems } = yield* waitForReadyWorkoutSets(client, olderWorkoutId, 1);
			const editedOlderSet = requirePresent(
				editedOlderItems[0],
				"Expected the edited older workout set",
			);
			expect(editedOlderSet.reps).toBe(20);
			const { items: editedNewerItems } = yield* waitForReadyWorkoutSets(client, newerWorkoutId, 1);
			const editedNewerSet = requirePresent(
				editedNewerItems[0],
				"Expected the newer workout set after historical edit",
			);
			expect(editedNewerSet.personalBests).toEqual(
				expect.arrayContaining(["reps", "one_rm", "volume"]),
			);
			expect(editedNewerSet.personalBests).not.toContain("weight");

			yield* client.call((c) => c.events.delete({ params: { eventId: olderEventId } }));
			const { items: deletedNewerItems } = yield* waitForReadyWorkoutSets(
				client,
				newerWorkoutId,
				1,
			);
			const deletedNewerSet = requirePresent(
				deletedNewerItems[0],
				"Expected the newer workout set after historical delete",
			);
			expect(deletedNewerSet.personalBests).toEqual(["reps", "one_rm", "volume", "weight"]);
		}),
	);

	it.live("selects prior sessions by workout start, not set confirmation time", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const previousStartedAt = "2026-06-01T10:00:00.000Z";
			const currentStartedAt = "2026-06-02T10:00:00.000Z";
			const { workoutId: previousWorkoutId } = yield* createWorkoutEntityFixture(client, {
				startedAt: previousStartedAt,
				endedAt: "2026-06-01T11:00:00.000Z",
			});
			const { workoutId: currentWorkoutId } = yield* createWorkoutEntityFixture(client, {
				startedAt: currentStartedAt,
				endedAt: "2026-06-02T11:00:00.000Z",
			});
			const { workoutId: equalStartWorkoutId } = yield* createWorkoutEntityFixture(client, {
				startedAt: currentStartedAt,
				endedAt: "2026-06-02T12:00:00.000Z",
			});
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);

			const createResult = yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: exerciseId,
							sessionEntityId: previousWorkoutId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: {
								reps: 8,
								setOrder: 0,
								exerciseOrder: 0,
								confirmedAt: "2026-06-02T10:01:00.000Z",
							},
						},
						{
							entityId: exerciseId,
							sessionEntityId: equalStartWorkoutId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: {
								reps: 9,
								setOrder: 0,
								exerciseOrder: 0,
								confirmedAt: "2026-06-02T10:03:00.000Z",
							},
						},
						{
							entityId: exerciseId,
							sessionEntityId: currentWorkoutId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: {
								reps: 10,
								setOrder: 0,
								exerciseOrder: 0,
								confirmedAt: "2026-06-02T10:05:00.000Z",
							},
						},
					],
				}),
			);
			expect((yield* waitForCreateEvents(client, createResult)).count).toBe(3);

			yield* waitForReadyWorkoutSets(client, previousWorkoutId, 1);
			yield* waitForReadyWorkoutSets(client, equalStartWorkoutId, 1);
			const current = yield* waitForReadyWorkoutSets(client, currentWorkoutId, 1);
			const currentExercise = requirePresent(
				current.workout.exercises.items[0],
				"Expected the current workout exercise",
			);
			expect(
				isoString(
					requirePresent(currentExercise.previousWorkoutStartedAt, "Expected a previous session"),
				),
			).toBe(previousStartedAt);
			expect(currentExercise.previousSets.items.map((set) => set.reps)).toEqual([8]);
		}),
	);

	it.live(
		"recomputes 101 sets of one exercise across sessions and keeps unknown completion fields null",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const earlierStartedAt = "2026-06-01T10:00:00.000Z";
				const laterStartedAt = "2026-06-02T10:00:00.000Z";
				const { workoutId: earlierWorkoutId } = yield* createWorkoutEntityFixture(client, {
					startedAt: earlierStartedAt,
					endedAt: "2026-06-01T11:00:00.000Z",
				});
				const { workoutId: laterWorkoutId } = yield* createWorkoutEntityFixture(client, {
					startedAt: laterStartedAt,
					endedAt: "2026-06-02T11:00:00.000Z",
				});
				const { exerciseId } = yield* createExerciseEntityFixture(client, { kind: "reps" });
				const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);

				const createResult = yield* client.call((c) =>
					c.events.create({
						payload: Array.from({ length: 101 }, (_, reps) => ({
							entityId: exerciseId,
							eventSchemaSlug: workoutSetEventSchema.id,
							sessionEntityId: reps < 51 ? earlierWorkoutId : laterWorkoutId,
							properties: { reps, exerciseOrder: 0, setOrder: reps < 51 ? reps : reps - 51 },
						})),
					}),
				);
				const created = yield* waitForCreateEvents(client, createResult, 600_000);
				expect(created.count).toBe(101);

				const earlier = yield* waitForReadyWorkoutSets(client, earlierWorkoutId, 51, 600_000);
				const later = yield* waitForReadyWorkoutSets(client, laterWorkoutId, 50, 600_000);

				const zeroRepSet = requirePresent(
					earlier.items.find((item) => item.reps === 0),
					"Expected the zero-rep workout set",
				);
				expect(zeroRepSet.personalBests).toEqual([]);
				const lastSet = requirePresent(
					later.items.find((item) => item.reps === 100),
					"Expected the last workout set",
				);
				expect(lastSet).toMatchObject({
					setOrder: 49,
					restTime: null,
					confirmedAt: null,
					recordStatus: "ready",
					personalBests: ["reps"],
				});
				const laterExercise = requirePresent(
					later.workout.exercises.items[0],
					"Expected the later workout exercise",
				);
				expect(laterExercise.previousSets.items).toHaveLength(51);
				const storedLastSet = yield* storedWorkoutSet(client, exerciseId, lastSet.id);
				expect(isoString(storedLastSet.occurredAt)).toBe(laterStartedAt);
			}),
		600_000,
	);

	it.live("skips a completed workout set created without workout context", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);

			const createResult = yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: exerciseId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: {
								reps: 10,
								weight: 10,
								setOrder: 0,
								exerciseOrder: 0,
								confirmedAt: "2026-06-02T10:05:00.000Z",
							},
						},
					],
				}),
			);
			const result = yield* waitForCreateEvents(client, createResult);

			expect(result.count).toBe(0);
			expect(result.outcomes).toMatchObject([{ index: 0, status: "skipped_by_policy" }]);
		}),
	);
});
