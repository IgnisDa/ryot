import type { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { fitnessAnalyticsTotalsRecipe } from "@ryot-app/fitness-plugin/analytics-recipes";
import { randomUuid } from "@ryot-app/testing/random";
import { Clock, Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { pollUntil } from "~/fixtures/kernel/polling";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { deleteUserAndWait } from "~/fixtures/kernel/user-lifecycle";
import { assertCondition } from "~/support/assertions";

import { createExerciseEntityFixture } from "./exercises";
import { createMeasurementMetric, logMeasurementReadings } from "./measurements";
import {
	saveWorkoutData,
	workoutData,
	workoutOccurrence,
	workoutReference,
	workoutSet,
} from "./workout-editor";
import { createWorkoutOccurrenceTaxonomy } from "./workout-occurrences";

const reportingSelection: ReportingSelection = {
	grouping: "day",
	comparison: "previous-period",
	range: { kind: "custom", endDate: "2026-09-07", startDate: "2026-09-01" },
};

const measurementValues = [
	{ value: 0, occurredAt: "2026-09-02T12:00:00.000Z" },
	{ value: 2.5, occurredAt: "2026-09-04T12:00:00.000Z" },
	{ value: 1.25, occurredAt: "2026-09-07T12:00:00.000Z" },
];

const expectedSourceValues = {
	sets: 3,
	workouts: 2,
	volume: 350,
	plannedRest: 150,
	activeDuration: 5400,
	measurementEntries: 3,
	measurementReadings: 3,
};

export const createFitnessAnalyticsFixture = Effect.fn("createFitnessAnalyticsFixture")(
	function* () {
		const account = yield* createAuthenticatedClient();
		yield* Effect.addFinalizer(() =>
			deleteUserAndWait(account.userId, account.client.target).pipe(Effect.ignore),
		);
		const { client } = account;

		const reference = yield* workoutReference(client);

		const { exerciseId } = yield* createExerciseEntityFixture(client, {
			kind: "reps_and_weight",
			name: `Analytics exercise ${yield* randomUuid}`,
		});
		const taxonomy = yield* createWorkoutOccurrenceTaxonomy(client, exerciseId, {
			equipmentCount: 1,
			targetRoles: ["primary", "secondary", "stabilizer"],
		});

		const firstWorkout = yield* saveWorkoutData(
			client,
			workoutData({
				endedAt: "2026-09-02T11:00:00.000Z",
				startedAt: "2026-09-02T10:00:00.000Z",
				activeDuration: { kind: "set", seconds: 3600 },
				occurrences: [
					workoutOccurrence(exerciseId, [
						workoutSet({
							restTime: 60,
							occurredAt: "2026-09-02T10:15:00.000Z",
							measurements: { reps: 10, weight: 10 },
							confirmedAt: "2026-09-02T10:15:00.000Z",
						}),
						workoutSet({
							restTime: 60,
							measurements: { reps: 5, weight: 20 },
							occurredAt: "2026-09-02T10:30:00.000Z",
							confirmedAt: "2026-09-02T10:30:00.000Z",
						}),
					]),
				],
			}),
		);
		assertCondition(firstWorkout.kind === "saved", "Expected the first analytics workout to save");

		const secondWorkout = yield* saveWorkoutData(
			client,
			workoutData({
				endedAt: "2026-09-04T18:30:00.000Z",
				startedAt: "2026-09-04T18:00:00.000Z",
				activeDuration: { kind: "set", seconds: 1800 },
				occurrences: [
					workoutOccurrence(exerciseId, [
						workoutSet({
							restTime: 30,
							occurredAt: "2026-09-04T18:15:00.000Z",
							measurements: { reps: 10, weight: 15 },
							confirmedAt: "2026-09-04T18:15:00.000Z",
						}),
					]),
				],
			}),
		);
		assertCondition(
			secondWorkout.kind === "saved",
			"Expected the second analytics workout to save",
		);

		const metricName = `Analytics widgets ${yield* randomUuid}`;
		const metric = yield* createMeasurementMetric(client, { unit: "widgets", name: metricName });
		for (const { value, occurredAt } of measurementValues) {
			const logged = yield* logMeasurementReadings(client, {
				occurredAt,
				values: [{ value, metricId: metric.entityId }],
			});
			assertCondition(
				logged.status === "saved" && logged.count === 1,
				"Expected each analytics measurement reading to save",
			);
		}

		const now = yield* Clock.currentTimeMillis;
		yield* pollUntil(
			"Fitness analytics workout sets to be processed",
			executeRyotQLRecipe(
				client,
				fitnessAnalyticsTotalsRecipe({
					now,
					reference,
					selection: reportingSelection,
					timeZone: TimeZone.make("UTC"),
				}),
			).pipe(Effect.map((report) => (report.pendingSets === 0 ? report : null))),
		);

		return {
			account,
			taxonomy,
			reference,
			exerciseId,
			reportingSelection,
			expectedSourceValues,
			measurementMetricName: metricName,
			measurementMetricId: metric.entityId,
			workoutIds: [firstWorkout.entityId, secondWorkout.entityId],
		};
	},
);
