import type { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import { TimeZone, UTC } from "@ryot-app/contract/schema/time-zone";
import {
	fitnessAnalyticsTotalsRecipe,
	fitnessAnalyticsTrendRecipe,
	fitnessMeasurementReadingsRecipe,
} from "@ryot-app/fitness-plugin/analytics-recipes";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	literal,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/ryotql";
import { randomUuid } from "@ryot-app/testing/random";
import { Clock, Effect, Result, Schema } from "effect";

import { getUserSettings, updateUserSettingsPreferences } from "~/fixtures/kernel/account";
import { type Client, createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { pollUntil } from "~/fixtures/kernel/polling";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { deleteUserAndWait } from "~/fixtures/kernel/user-lifecycle";
import { assertCondition } from "~/support/assertions";

import { createWorkoutEvidenceTaxonomy } from "./analytics-evidence";
import { createExerciseEntityFixture, findFitnessEntitySchema } from "./exercises";
import { createMeasurementMetric, logMeasurementReadings } from "./measurements";
import {
	saveWorkoutData,
	workoutData,
	workoutOccurrence,
	workoutReference,
	workoutSet,
} from "./workout-editor";

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
	activeDays: 2,
	repetitions: 25,
	plannedRest: 150,
	equipmentCount: 1,
	previousWorkouts: 0,
	activeDuration: 5400,
	measurementEntries: 3,
	missingTaxonomySets: 0,
	measurementReadings: 3,
	missingMeasurementDates: ["2026-09-03", "2026-09-05", "2026-09-06"],
	targetWeights: [
		["primary", 3],
		["secondary", 1.5],
		["stabilizer", 0],
	],
	measurements: measurementValues.map(({ value, occurredAt }) => ({
		value,
		date: occurredAt.slice(0, 10),
	})),
};

const workoutEvidenceRevisionRecipe = defineRecipe(
	(input: { readonly workoutId: string; readonly reference: PluginIdentityReference }) => {
		const scope = table("eventScope", "analyticsWorkoutEvidenceScope");
		return {
			map: ({ scope: revision }) => Result.succeed(revision?.revision ?? 0),
			queries: {
				scope: selectedOptionalRow(scope, {
					orderBy: [ascending(column(scope, "id"))],
					selection: { revision: selectedField(column(scope, "revision"), Schema.Int) },
					where: and(
						schemaOwnerPredicate(scope, "eventSchemaPluginId", input.reference),
						eq(column(scope, "entityId"), literal(input.workoutId)),
					),
				}),
			},
		};
	},
);

const workoutEvidenceRevisions = (
	client: Client,
	workoutIds: readonly string[],
	reference: PluginIdentityReference,
) =>
	Effect.forEach(workoutIds, (workoutId) =>
		executeRyotQLRecipe(client, workoutEvidenceRevisionRecipe({ workoutId, reference })).pipe(
			Effect.map((revision) => ({ revision, workoutId })),
		),
	);

export const createFitnessAnalyticsFixture = Effect.fn("createFitnessAnalyticsFixture")(
	function* () {
		const account = yield* createAuthenticatedClient();
		yield* Effect.addFinalizer(() =>
			deleteUserAndWait(account.userId, account.client.target).pipe(Effect.ignore),
		);
		const { client } = account;

		yield* updateUserSettingsPreferences(client, { reportingTimeZone: UTC });
		assertCondition(
			(yield* getUserSettings(client)).preferences.reportingTimeZone === TimeZone.make("UTC"),
			"Expected the analytics fixture account to use UTC reporting time",
		);

		const fitnessExerciseDefinition = yield* findFitnessEntitySchema(client, "exercise");
		const owner = fitnessExerciseDefinition.schema.reference.owner;
		assertCondition(
			owner.kind === "plugin" && owner.pluginId === fitnessExerciseDefinition.pluginId,
			"Expected the Fitness exercise schema to have its installed plugin owner",
		);
		const reference = yield* workoutReference(client);
		assertCondition(
			reference.pluginId === fitnessExerciseDefinition.pluginId,
			"Expected the Fitness reporting reference to resolve to the installed plugin",
		);

		const { exerciseId } = yield* createExerciseEntityFixture(client, {
			kind: "reps_and_weight",
			name: `Analytics exercise ${yield* randomUuid}`,
		});
		const taxonomy = yield* createWorkoutEvidenceTaxonomy(client, exerciseId, {
			equipmentCount: 1,
			targetRoles: ["primary", "secondary", "stabilizer"],
		});

		const firstStartedAt = "2026-09-02T10:00:00.000Z";
		const firstWorkout = yield* saveWorkoutData(
			client,
			workoutData({
				startedAt: firstStartedAt,
				endedAt: "2026-09-02T11:00:00.000Z",
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

		const secondStartedAt = "2026-09-04T18:00:00.000Z";
		const secondWorkout = yield* saveWorkoutData(
			client,
			workoutData({
				startedAt: secondStartedAt,
				endedAt: "2026-09-04T18:30:00.000Z",
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

		const workoutIds = [firstWorkout.entityId, secondWorkout.entityId];
		const setIds = [...firstWorkout.sets, ...secondWorkout.sets].map(({ eventId }) => eventId);
		const revisionsBeforeReadiness = yield* workoutEvidenceRevisions(client, workoutIds, reference);

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
		const totals = yield* pollUntil(
			"canonical Fitness analytics workout projections to be ready",
			executeRyotQLRecipe(
				client,
				fitnessAnalyticsTotalsRecipe({
					now,
					reference,
					selection: reportingSelection,
					timeZone: TimeZone.make("UTC"),
					filter: { id: exerciseId, kind: "exercises" },
				}),
			).pipe(
				Effect.map((report) => {
					if (report.failedSets > 0) {
						throw new Error("Fitness analytics fixture workout projection failed");
					}
					const ready =
						report.pendingSets === 0 &&
						report.workouts === expectedSourceValues.workouts &&
						report.sets === expectedSourceValues.sets &&
						report.repetitions === expectedSourceValues.repetitions &&
						report.volume === expectedSourceValues.volume &&
						report.activeDays === expectedSourceValues.activeDays &&
						report.plannedRest === expectedSourceValues.plannedRest &&
						report.activeDuration === expectedSourceValues.activeDuration &&
						report.missingTaxonomySets === expectedSourceValues.missingTaxonomySets &&
						report.measurementEntries === expectedSourceValues.measurementEntries &&
						report.measurementReadings === expectedSourceValues.measurementReadings;
					return ready ? report : null;
				}),
			),
		);
		assertCondition(
			totals.failedSets === 0 && totals.pendingSets === 0,
			"Expected all canonical Fitness workout projections to be current",
		);

		const currentRevisions = yield* workoutEvidenceRevisions(client, workoutIds, reference);
		const currentRevisionByWorkout = new Map(
			currentRevisions.map(({ revision, workoutId }) => [workoutId, revision]),
		);
		assertCondition(
			revisionsBeforeReadiness.length === currentRevisions.length &&
				revisionsBeforeReadiness.every(
					(before) => currentRevisionByWorkout.get(before.workoutId) === before.revision,
				),
			"Expected workout evidence revisions to remain current while projections became ready",
		);

		const previousWorkouts = yield* executeRyotQLRecipe(
			client,
			fitnessAnalyticsTrendRecipe({
				now,
				reference,
				metric: "workouts",
				period: "previous",
				selection: reportingSelection,
				timeZone: TimeZone.make("UTC"),
				filter: { id: exerciseId, kind: "exercises" },
			}),
		);
		assertCondition(
			previousWorkouts.points.length === expectedSourceValues.previousWorkouts &&
				!previousWorkouts.hasMore,
			"Expected the analytics fixture previous period to have no workouts",
		);

		const measurementReadings = yield* executeRyotQLRecipe(
			client,
			fitnessMeasurementReadingsRecipe({
				now,
				reference,
				metricId: metric.entityId,
				selection: reportingSelection,
				timeZone: TimeZone.make("UTC"),
			}),
		);
		assertCondition(
			measurementReadings.items.length === expectedSourceValues.measurementReadings &&
				!measurementReadings.pageInfo.hasMore,
			"Expected exactly three analytics measurement readings",
		);
		for (const expected of measurementValues) {
			assertCondition(
				measurementReadings.items.some(
					(reading) =>
						reading.occurredAt.slice(0, 10) === expected.occurredAt.slice(0, 10) &&
						reading.value === expected.value &&
						reading.unit === "widgets",
				),
				`Expected analytics measurement reading at ${expected.occurredAt}`,
			);
		}

		return {
			owner,
			setIds,
			account,
			taxonomy,
			reference,
			exerciseId,
			workoutIds,
			reportingSelection,
			expectedSourceValues,
			measurementMetricName: metricName,
			measurementMetricId: metric.entityId,
			workoutEvidenceRevisions: currentRevisions,
		};
	},
);
