import type { CreateEventsResponse } from "@ryot-app/contract/modules/events/schemas";
import {
	column,
	defineRecipe,
	eq,
	literal,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/ryotql";
import { Effect, Result, Schema, Struct } from "effect";

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
	editTarget,
	findWorkoutSetEventSchema,
	LARGE_WORKOUT_BUDGET,
	loadWorkoutBaseline,
	readWorkoutDetails,
	saveWorkoutData,
	workoutData,
	workoutOccurrence,
	workoutSet,
} from "~/fixtures/plugins/fitness";
import { readWorkoutExerciseEvidence } from "~/fixtures/plugins/fitness/analytics-evidence";
import {
	createKindChangingExerciseFixture,
	saveHistoricalWorkoutData,
} from "~/fixtures/plugins/fitness/workout-records";
import { assertCondition, assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const waitForReadyWorkoutSets = (
	client: Client,
	workoutId: string,
	expectedCount: number,
	timeoutMs?: number,
) =>
	pollUntil(
		`${expectedCount} ready workout sets for ${workoutId}`,
		Effect.gen(function* () {
			const workout = yield* readWorkoutDetails(client, workoutId);
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

const isoString = (value: Date | string) => new Date(value).toISOString();

const workoutSourceRecipe = defineRecipe((input: { readonly eventId: string }) => {
	const source = table("event", "source");
	return {
		map: ({ event }) => Result.succeed(event),
		queries: {
			event: selectedOptionalRow(source, {
				orderBy: [],
				where: eq(column(source, "id"), literal(input.eventId)),
				selection: {
					updatedAt: selectedField(column(source, "updatedAt"), Schema.String),
					properties: selectedField(
						column(source, "properties"),
						Schema.Record(Schema.String, Schema.Unknown),
					),
				},
			}),
		},
	};
});
const storedWorkoutSource = (client: Client, eventId: string) =>
	executeRyotQLRecipe(client, workoutSourceRecipe({ eventId })).pipe(
		Effect.map((source) => requirePresent(source, "Expected the stored source event")),
	);

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
	it.live(
		"stores metric measurements at their declared scale and rejects undeclared unit input",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const workoutStartedAt = "2026-06-02T10:00:00.000Z";
				const { exerciseId } = yield* createExerciseEntityFixture(client);
				const created = yield* saveHistoricalWorkoutData(
					client,
					workoutData({
						startedAt: workoutStartedAt,
						endedAt: "2026-06-02T11:00:00.000Z",
						occurrences: [
							workoutOccurrence(exerciseId, [
								Struct.omit(
									workoutSet({
										occurredAt: workoutStartedAt,
										measurements: { reps: 10, weight: 10 },
									}),
									["confirmedAt"],
								),
							]),
						],
					}),
				);
				assertCondition(created.kind === "saved", "Expected the workout to save");
				expect(created.sets).toHaveLength(1);
				const workoutId = created.entityId;
				const eventId = requirePresent(created.sets[0]?.eventId, "Expected the workout set event");

				const { items: initialItems } = yield* waitForReadyWorkoutSets(client, workoutId, 1);
				expect(initialItems[0]?.confirmedAt).toBeNull();

				const rejected = yield* Effect.flip(
					client.call((c) =>
						c.events.update({
							params: { eventId },
							payload: { properties: { remove: [], set: { weight: 45, unitSystem: "imperial" } } },
						}),
					),
				);
				assertTaggedError(rejected, "EventBadRequest");
				expect(rejected.reason).toMatchObject({ code: "invalid-properties" });
				const computedWrite = yield* Effect.flip(
					client.call((c) =>
						c.events.update({
							params: { eventId },
							payload: { properties: { remove: [], set: { oneRm: 123 } } },
						}),
					),
				);
				assertTaggedError(computedWrite, "EventBadRequest");
				expect(computedWrite.reason).toMatchObject({ code: "invalid-properties" });

				yield* client.call((c) =>
					c.events.update({
						params: { eventId },
						payload: {
							properties: { remove: [], set: { weight: 100.0000012, distance: 1.00000000049 } },
						},
					}),
				);

				const { items: updatedItems } = yield* waitForReadyWorkoutSets(client, workoutId, 1);
				const updatedSet = requirePresent(updatedItems[0], "Expected the updated workout set");
				expect(updatedSet.weight).toBe(100.000001);
				expect(updatedSet.distance).toBeNull();
				const storedSet = yield* storedWorkoutSet(client, exerciseId, eventId);
				expect(storedSet.properties["weight"]).toBe(100.000001);
				expect(storedSet.properties["distance"]).toBe(1);
				expect(storedSet.properties).not.toHaveProperty("unitSystem");
			}),
	);

	it.live("recomputes historical workout-set personal bests after insert, update, and delete", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const newerStartedAt = "2026-06-02T10:00:00.000Z";
			const newerConfirmedAt = "2026-06-02T10:05:00.000Z";
			const olderStartedAt = "2026-06-01T10:00:00.000Z";
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const newerCreate = yield* saveWorkoutData(
				client,
				workoutData({
					startedAt: newerStartedAt,
					endedAt: "2026-06-02T11:00:00.000Z",
					occurrences: [
						workoutOccurrence(exerciseId, [
							workoutSet({
								restTime: 45,
								occurredAt: newerStartedAt,
								confirmedAt: newerConfirmedAt,
								measurements: { reps: 25, weight: 10 },
							}),
						]),
					],
				}),
			);
			assertCondition(newerCreate.kind === "saved", "Expected the newer workout to save");
			expect(newerCreate.sets).toHaveLength(1);
			const newerWorkoutId = newerCreate.entityId;
			const newerEventId = requirePresent(
				newerCreate.sets[0]?.eventId,
				"Expected the newer workout set event",
			);

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

			const olderCreate = yield* saveHistoricalWorkoutData(
				client,
				workoutData({
					startedAt: olderStartedAt,
					endedAt: "2026-06-01T11:00:00.000Z",
					occurrences: [
						workoutOccurrence(exerciseId, [
							Struct.omit(
								workoutSet({ occurredAt: olderStartedAt, measurements: { reps: 25, weight: 10 } }),
								["confirmedAt"],
							),
						]),
					],
				}),
			);
			assertCondition(olderCreate.kind === "saved", "Expected the older workout to save");
			expect(olderCreate.sets).toHaveLength(1);
			const olderWorkoutId = olderCreate.entityId;
			const olderEventId = requirePresent(
				olderCreate.sets[0]?.eventId,
				"Expected the older workout set event",
			);

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

			const olderBaseline = yield* loadWorkoutBaseline(client, olderWorkoutId);
			const deletedOlder = yield* saveWorkoutData(
				client,
				workoutData({
					occurrences: [],
					startedAt: olderStartedAt,
					target: editTarget(olderBaseline),
					endedAt: "2026-06-01T11:00:00.000Z",
					name: olderBaseline.baseline.entity.name,
				}),
			);
			assertCondition(deletedOlder.kind === "saved", "Expected the older set to be removed");
			expect(deletedOlder.sets).toHaveLength(0);
			yield* waitForReadyWorkoutSets(client, olderWorkoutId, 0);
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
			const { exerciseId } = yield* createExerciseEntityFixture(client);
			const previousCreated = yield* saveWorkoutData(
				client,
				workoutData({
					startedAt: previousStartedAt,
					endedAt: "2026-06-01T11:00:00.000Z",
					occurrences: [
						workoutOccurrence(exerciseId, [
							workoutSet({
								occurredAt: previousStartedAt,
								exerciseKind: "reps_and_weight",
								measurements: { reps: 8, weight: 10 },
								confirmedAt: "2026-06-02T10:01:00.000Z",
							}),
						]),
					],
				}),
			);
			assertCondition(previousCreated.kind === "saved", "Expected the previous workout to save");
			expect(previousCreated.sets).toHaveLength(1);
			const equalStartCreated = yield* saveWorkoutData(
				client,
				workoutData({
					startedAt: currentStartedAt,
					endedAt: "2026-06-02T12:00:00.000Z",
					occurrences: [
						workoutOccurrence(exerciseId, [
							workoutSet({
								occurredAt: currentStartedAt,
								exerciseKind: "reps_and_weight",
								measurements: { reps: 9, weight: 10 },
								confirmedAt: "2026-06-02T10:03:00.000Z",
							}),
						]),
					],
				}),
			);
			assertCondition(
				equalStartCreated.kind === "saved",
				"Expected the equal-start workout to save",
			);
			expect(equalStartCreated.sets).toHaveLength(1);
			const currentCreated = yield* saveWorkoutData(
				client,
				workoutData({
					startedAt: currentStartedAt,
					endedAt: "2026-06-02T11:00:00.000Z",
					occurrences: [
						workoutOccurrence(exerciseId, [
							workoutSet({
								occurredAt: currentStartedAt,
								exerciseKind: "reps_and_weight",
								measurements: { reps: 10, weight: 10 },
								confirmedAt: "2026-06-02T10:05:00.000Z",
							}),
						]),
					],
				}),
			);
			assertCondition(currentCreated.kind === "saved", "Expected the current workout to save");
			expect(currentCreated.sets).toHaveLength(1);
			expect(
				previousCreated.sets.length + equalStartCreated.sets.length + currentCreated.sets.length,
			).toBe(3);
			const previousWorkoutId = previousCreated.entityId;
			const equalStartWorkoutId = equalStartCreated.entityId;
			const currentWorkoutId = currentCreated.entityId;
			for (const created of [previousCreated, equalStartCreated, currentCreated]) {
				const { eventId } = requirePresent(created.sets[0], "Expected the recorded weighted set");
				yield* client.call((c) =>
					c.events.update({
						params: { eventId },
						payload: { properties: { set: {}, remove: ["weight"] } },
					}),
				);
				const stored = yield* storedWorkoutSet(client, exerciseId, eventId);
				expect(stored.properties).not.toHaveProperty("weight");
			}

			const previous = yield* waitForReadyWorkoutSets(client, previousWorkoutId, 1);
			const equalStart = yield* waitForReadyWorkoutSets(client, equalStartWorkoutId, 1);
			const current = yield* waitForReadyWorkoutSets(client, currentWorkoutId, 1);
			for (const workout of [previous, equalStart, current]) {
				expect(workout.items[0]).toMatchObject({
					oneRm: null,
					weight: null,
					volume: null,
					recordStatus: "ready",
					personalBests: ["reps"],
					exerciseKind: "reps_and_weight",
				});
			}
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
			const currentEventId = requirePresent(
				currentCreated.sets[0]?.eventId,
				"Expected current set",
			);
			yield* client.call((c) =>
				c.events.update({
					params: { eventId: currentEventId },
					payload: { properties: { remove: [], set: { weight: 10 } } },
				}),
			);
			const repaired = yield* waitForReadyWorkoutSets(client, currentWorkoutId, 1);
			expect(repaired.items[0]).toMatchObject({
				weight: 10,
				volume: 100,
				oneRm: 13.333333,
				recordStatus: "ready",
				personalBests: ["reps", "one_rm", "volume", "weight"],
			});
			expect(
				repaired.workout.exercises.items[0]?.previousSets.items.map((set) => set.reps),
			).toEqual([8]);
		}),
	);

	it.live(
		"recomputes 101 sets of one exercise across sessions and keeps unknown completion fields null",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const earlierStartedAt = "2026-06-01T10:00:00.000Z";
				const laterStartedAt = "2026-06-02T10:00:00.000Z";
				const { exerciseId } = yield* createExerciseEntityFixture(client, { kind: "reps" });
				const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);
				const earlierCreated = yield* saveHistoricalWorkoutData(
					client,
					workoutData({
						startedAt: earlierStartedAt,
						endedAt: "2026-06-01T11:00:00.000Z",
						occurrences: [
							workoutOccurrence(exerciseId, [
								Struct.omit(
									workoutSet({
										exerciseKind: "reps",
										measurements: { reps: 0 },
										occurredAt: earlierStartedAt,
									}),
									["confirmedAt"],
								),
							]),
						],
					}),
				);
				assertCondition(earlierCreated.kind === "saved", "Expected the earlier workout to save");
				expect(earlierCreated.sets).toHaveLength(1);
				const laterCreated = yield* saveHistoricalWorkoutData(
					client,
					workoutData({
						startedAt: laterStartedAt,
						endedAt: "2026-06-02T11:00:00.000Z",
						occurrences: [
							workoutOccurrence(exerciseId, [
								Struct.omit(
									workoutSet({
										exerciseKind: "reps",
										occurredAt: laterStartedAt,
										measurements: { reps: 51 },
									}),
									["confirmedAt"],
								),
							]),
						],
					}),
				);
				assertCondition(laterCreated.kind === "saved", "Expected the later workout to save");
				expect(laterCreated.sets).toHaveLength(1);
				const earlierWorkoutId = earlierCreated.entityId;
				const laterWorkoutId = laterCreated.entityId;

				const createResult = yield* client.call((c) =>
					c.events.create({
						payload: Array.from({ length: 101 }, (_, reps) => ({
							entityId: exerciseId,
							eventSchemaSlug: workoutSetEventSchema.id,
							occurredAt: reps < 51 ? earlierStartedAt : laterStartedAt,
							sessionEntityId: reps < 51 ? earlierWorkoutId : laterWorkoutId,
							properties: { reps, exerciseOrder: 0, setOrder: reps < 51 ? reps : reps - 51 },
						})).filter((_, reps) => reps !== 0 && reps !== 51),
					}),
				);
				const created = yield* waitForCreateEvents(
					client,
					createResult,
					LARGE_WORKOUT_BUDGET.eventsMs,
				);
				expect(created).toMatchObject({ count: 99, failure: null });
				expect(created.count + earlierCreated.sets.length + laterCreated.sets.length).toBe(101);
				const lastEventId = requireWorkoutSetEventId(created, 98);
				const sourceBefore = yield* storedWorkoutSource(client, lastEventId);

				const earlier = yield* waitForReadyWorkoutSets(
					client,
					earlierWorkoutId,
					51,
					LARGE_WORKOUT_BUDGET.eventsMs,
				);
				const later = yield* waitForReadyWorkoutSets(
					client,
					laterWorkoutId,
					50,
					LARGE_WORKOUT_BUDGET.eventsMs,
				);
				const allSets = [
					...earlier.workout.exercises.items.flatMap((exercise) => exercise.sets.items),
					...later.workout.exercises.items.flatMap((exercise) => exercise.sets.items),
				];
				expect(allSets).toHaveLength(101);
				expect(allSets.reduce((total, set) => total + (set.reps ?? 0), 0)).toBe(5050);
				expect(allSets.every((set) => set.confirmedAt === null)).toBe(true);
				const sourceAfter = yield* storedWorkoutSource(client, lastEventId);
				expect(sourceAfter.updatedAt).toBe(sourceBefore.updatedAt);
				expect(sourceAfter.properties).toEqual(sourceBefore.properties);
				for (const field of ["personalBests", "oneRm", "volume", "pace"]) {
					expect(sourceAfter.properties).not.toHaveProperty(field);
				}

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
		LARGE_WORKOUT_BUDGET.testMs,
	);

	it.live("keeps each set's recorded kind and tracks personal bests per kind", () =>
		Effect.gen(function* () {
			const fixture = yield* createKindChangingExerciseFixture();
			const { client, exerciseId } = fixture;
			const earlierStartedAt = "2026-06-01T10:00:00.000Z";
			const laterStartedAt = "2026-06-02T10:00:00.000Z";
			expect(fixture.exercise).toMatchObject({
				id: exerciseId,
				externalId: fixture.externalId,
				providerId: fixture.providerId,
				properties: { kind: "reps_and_weight" },
			});
			const earlierCreated = yield* saveHistoricalWorkoutData(
				client,
				workoutData({
					startedAt: earlierStartedAt,
					endedAt: "2026-06-01T11:00:00.000Z",
					occurrences: [
						workoutOccurrence(exerciseId, [
							Struct.omit(
								workoutSet({
									occurredAt: earlierStartedAt,
									exerciseKind: "reps_and_weight",
									measurements: { reps: 10, weight: 20 },
								}),
								["confirmedAt"],
							),
						]),
					],
				}),
			);
			assertCondition(earlierCreated.kind === "saved", "Expected the weighted workout to save");
			expect(earlierCreated.sets).toHaveLength(1);
			const weightedEventId = requirePresent(
				earlierCreated.sets[0]?.eventId,
				"Expected the weighted workout set event",
			);
			yield* waitForReadyWorkoutSets(client, earlierCreated.entityId, 1);
			const weightedSourceBefore = yield* storedWorkoutSource(client, weightedEventId);
			const weightedEvidenceBefore = yield* readWorkoutExerciseEvidence(
				client,
				exerciseId,
				earlierCreated.entityId,
			);
			expect(weightedEvidenceBefore).toHaveLength(1);
			expect(weightedEvidenceBefore[0]?.properties.exerciseKind).toBe("reps_and_weight");
			const changedExercise = yield* fixture.changeKind("reps");
			expect(changedExercise).toMatchObject({
				id: exerciseId,
				properties: { kind: "reps" },
				externalId: fixture.externalId,
				providerId: fixture.providerId,
			});
			expect(yield* storedWorkoutSource(client, weightedEventId)).toEqual(weightedSourceBefore);
			expect(
				yield* readWorkoutExerciseEvidence(client, exerciseId, earlierCreated.entityId),
			).toEqual(weightedEvidenceBefore);
			const laterCreated = yield* saveHistoricalWorkoutData(
				client,
				workoutData({
					startedAt: laterStartedAt,
					endedAt: "2026-06-02T11:00:00.000Z",
					occurrences: [
						workoutOccurrence(exerciseId, [
							Struct.omit(
								workoutSet({
									exerciseKind: "reps",
									measurements: { reps: 6 },
									occurredAt: laterStartedAt,
								}),
								["confirmedAt"],
							),
						]),
					],
				}),
			);
			assertCondition(laterCreated.kind === "saved", "Expected the repetitions workout to save");
			expect(laterCreated.sets).toHaveLength(1);
			expect(earlierCreated.sets.length + laterCreated.sets.length).toBe(2);
			const earlierWorkoutId = earlierCreated.entityId;
			const laterWorkoutId = laterCreated.entityId;

			const earlier = yield* waitForReadyWorkoutSets(client, earlierWorkoutId, 1);
			const later = yield* waitForReadyWorkoutSets(client, laterWorkoutId, 1);
			expect(earlier.items[0]).toMatchObject({
				volume: 200,
				oneRm: 26.666667,
				exerciseKind: "reps_and_weight",
				personalBests: ["reps", "one_rm", "volume", "weight"],
			});
			expect(later.items[0]).toMatchObject({
				oneRm: null,
				volume: null,
				exerciseKind: "reps",
				personalBests: ["reps"],
			});
			expect(earlier.items[0]?.confirmedAt).toBeNull();
			expect(later.items[0]?.confirmedAt).toBeNull();
			expect(yield* storedWorkoutSource(client, weightedEventId)).toEqual(weightedSourceBefore);
			expect(yield* readWorkoutExerciseEvidence(client, exerciseId, earlierWorkoutId)).toEqual(
				weightedEvidenceBefore,
			);
			const laterEvidence = yield* readWorkoutExerciseEvidence(client, exerciseId, laterWorkoutId);
			expect(laterEvidence).toHaveLength(1);
			expect(laterEvidence[0]?.properties.exerciseKind).toBe("reps");

			yield* client.call((c) =>
				c.events.update({
					params: { eventId: weightedEventId },
					payload: { properties: { remove: [], set: { reps: 12 } } },
				}),
			);
			const edited = yield* waitForReadyWorkoutSets(client, earlierWorkoutId, 1);
			expect(edited.items[0]).toMatchObject({ reps: 12, exerciseKind: "reps_and_weight" });
			const storedSet = yield* storedWorkoutSet(client, exerciseId, weightedEventId);
			expect(storedSet.properties["exerciseKind"]).toBe("reps_and_weight");
			expect(yield* readWorkoutExerciseEvidence(client, exerciseId, earlierWorkoutId)).toEqual(
				weightedEvidenceBefore,
			);
		}),
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
