import type { CreateEventsResponse } from "@ryot-app/contract/modules/events/schemas";
import { workoutSetsRecipe } from "@ryot-app/fitness-plugin/workout-details-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
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

const workoutSetsPage = (client: Client, workoutId: string, after?: string) =>
	executeRyotQLRecipe(client, workoutSetsRecipe({ after, workoutId, limit: 100 }));

const waitForReadyWorkoutSets = (
	client: Client,
	workoutId: string,
	expectedCount: number,
	timeoutMs?: number,
) =>
	pollUntil(
		`${expectedCount} ready workout sets for ${workoutId}`,
		Effect.gen(function* () {
			let page = yield* workoutSetsPage(client, workoutId);
			const items = [...page.items];
			while (page.pageInfo.hasMore) {
				const cursor = requirePresent(
					page.pageInfo.nextCursor,
					"Workout sets have more results but no next cursor",
				);
				page = yield* workoutSetsPage(client, workoutId, cursor);
				items.push(...page.items);
			}
			assertCondition(
				!items.some((item) => item.recordStatus === "failed"),
				"Workout record processing failed",
			);
			return items.length === expectedCount && items.every((item) => item.recordStatus === "ready")
				? items
				: null;
		}),
		timeoutMs,
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

			const updatedItems = yield* waitForReadyWorkoutSets(client, workoutId, 1);
			const updatedSet = requirePresent(updatedItems[0], "Expected the updated workout set");
			expect(updatedSet.weight).toBe(45.359238);
			expect(updatedSet.distance).toBe(1.609344001);
			expect(updatedSet.unitSystem).toBe("metric");
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
			expect((yield* waitForCreateEvents(client, newerCreate)).count).toBe(1);

			const initialNewerItems = yield* waitForReadyWorkoutSets(client, newerWorkoutId, 1);
			const initialNewerSet = requirePresent(
				initialNewerItems[0],
				"Expected the newer workout set",
			);
			expect(initialNewerSet).toMatchObject({
				volume: 250,
				restTime: 45,
				oneRm: 18.333333,
				unitSystem: "metric",
				recordStatus: "ready",
				occurredAt: newerConfirmedAt,
				confirmedAt: newerConfirmedAt,
				personalBests: ["reps", "one_rm", "volume", "weight"],
			});

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

			const olderItems = yield* waitForReadyWorkoutSets(client, olderWorkoutId, 1);
			const olderSet = requirePresent(olderItems[0], "Expected the older workout set");
			expect(olderSet).toMatchObject({
				restTime: null,
				confirmedAt: null,
				recordStatus: "ready",
				occurredAt: olderStartedAt,
				personalBests: ["reps", "one_rm", "volume", "weight"],
			});
			const insertedNewerItems = yield* waitForReadyWorkoutSets(client, newerWorkoutId, 1);
			const insertedNewerSet = requirePresent(
				insertedNewerItems[0],
				"Expected the newer workout set after historical insert",
			);
			expect(insertedNewerSet.personalBests).toEqual([]);
			expect(insertedNewerSet.previousSessionId).toBe(olderWorkoutId);

			yield* client.call((c) =>
				c.events.update({
					params: { eventId: olderEventId },
					payload: { properties: { remove: [], set: { reps: 20 } } },
				}),
			);
			const editedOlderItems = yield* waitForReadyWorkoutSets(client, olderWorkoutId, 1);
			const editedOlderSet = requirePresent(
				editedOlderItems[0],
				"Expected the edited older workout set",
			);
			expect(editedOlderSet.reps).toBe(20);
			const editedNewerItems = yield* waitForReadyWorkoutSets(client, newerWorkoutId, 1);
			const editedNewerSet = requirePresent(
				editedNewerItems[0],
				"Expected the newer workout set after historical edit",
			);
			expect(editedNewerSet.personalBests).toEqual(
				expect.arrayContaining(["reps", "one_rm", "volume"]),
			);
			expect(editedNewerSet.personalBests).not.toContain("weight");

			yield* client.call((c) => c.events.delete({ params: { eventId: olderEventId } }));
			const deletedNewerItems = yield* waitForReadyWorkoutSets(client, newerWorkoutId, 1);
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
			const currentItems = yield* waitForReadyWorkoutSets(client, currentWorkoutId, 1);
			const currentSet = requirePresent(currentItems[0], "Expected the current workout set");
			expect(currentSet.previousSessionId).toBe(previousWorkoutId);
		}),
	);

	it.live(
		"returns all 101 workout sets across recipe pages and keeps unknown completion fields null",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const workoutStartedAt = "2026-06-02T10:00:00.000Z";
				const { workoutId } = yield* createWorkoutEntityFixture(client, {
					startedAt: workoutStartedAt,
					endedAt: "2026-06-02T11:00:00.000Z",
				});
				const { exerciseId } = yield* createExerciseEntityFixture(client, { kind: "reps" });
				const { workoutSetEventSchema } = yield* findWorkoutSetEventSchema(client);

				const createResult = yield* client.call((c) =>
					c.events.create({
						payload: Array.from({ length: 101 }, (_, setOrder) => ({
							entityId: exerciseId,
							sessionEntityId: workoutId,
							eventSchemaSlug: workoutSetEventSchema.id,
							properties: { setOrder, reps: setOrder, exerciseOrder: 0 },
						})),
					}),
				);
				expect((yield* waitForCreateEvents(client, createResult, 600_000)).count).toBe(101);

				yield* waitForReadyWorkoutSets(client, workoutId, 101, 600_000);

				const firstPage = yield* workoutSetsPage(client, workoutId);
				expect(firstPage.items).toHaveLength(100);
				expect(firstPage.pageInfo.hasMore).toBe(true);
				const cursor = requirePresent(
					firstPage.pageInfo.nextCursor,
					"Expected another workout-set page",
				);
				const secondPage = yield* workoutSetsPage(client, workoutId, cursor);
				expect(secondPage.items).toHaveLength(1);
				expect(secondPage.pageInfo).toEqual({ limit: 100, hasMore: false, nextCursor: null });

				const items = [...firstPage.items, ...secondPage.items];
				expect(new Set(items.map((item) => item.setOrder))).toEqual(
					new Set(Array.from({ length: 101 }, (_, index) => index)),
				);
				const zeroRepSet = requirePresent(
					items.find((item) => item.reps === 0),
					"Expected the zero-rep workout set",
				);
				expect(zeroRepSet.personalBests).toEqual([]);
				const lastSet = requirePresent(
					items.find((item) => item.setOrder === 100),
					"Expected the last workout set",
				);
				expect(lastSet).toMatchObject({
					reps: 100,
					setOrder: 100,
					restTime: null,
					confirmedAt: null,
					recordStatus: "ready",
					personalBests: ["reps"],
					occurredAt: workoutStartedAt,
				});
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
