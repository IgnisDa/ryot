import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	type Reported,
	reportingExecution,
	type ResolvedReportingSelection,
} from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery, type ReportingPageParam } from "@ryot-app/plugin-client-sdk/react";

import {
	fitnessAnalyticsTotalsRecipe,
	fitnessAnalyticsTrendRecipe,
	fitnessAnalyticsWorkoutsRecipe,
	fitnessMeasurementReadingsRecipe,
	fitnessMeasurementTrendRecipe,
	fitnessWorkoutStartsByHourRecipe,
	historicalFitnessRankingRecipe,
} from "../../shared/analytics-recipes";
import { measurementSummaryRecipe } from "../../shared/measurement-recipes";
import {
	type AnalyticsInput,
	type AnalyticsRanking,
	type AnalyticsTotals,
	type AnalyticsTrend,
	type AnalyticsWorkouts,
	type Compared,
	consistencySelection,
	type MeasurementMetrics,
	type MeasurementReadings,
	type MeasurementTrend,
	type WorkoutHours,
} from "./reporting-model";

type PageInput<Input> = Input & { readonly page?: ReportingPageParam };
export const analyticsPageInput = <Input>(
	input: Input,
	page: ReportingPageParam,
): PageInput<Input> => ({ ...input, page });

const pagedReporting = (input: PageInput<Omit<AnalyticsInput, "filter">>, now: number) =>
	reportingExecution(input.page?.selection ?? input.selection, { now, timeZone: input.timeZone });

const compared = <Data, Failure>(
	input: AnalyticsInput,
	now: number,
	read: (reporting: ResolvedReportingSelection) => Effect.Effect<Data, Failure>,
): Effect.Effect<Compared<Data>, Failure> =>
	Effect.gen(function* () {
		const reporting = reportingExecution(input.selection, { now, timeZone: input.timeZone });
		const resolved = reporting.resolved;
		const previous = resolved.previous;
		const results = yield* Effect.all(
			{
				current: read(resolved),
				previous:
					previous === null
						? Effect.succeed(null)
						: read({ ...resolved, previous: null, current: previous }),
			},
			{ concurrency: 2 },
		);
		return { ...results, reporting };
	});

export const analyticsSummaryQuery = createRyotQuery<AnalyticsInput, Compared<AnalyticsTotals>>(
	({ input, client, schedule }) =>
		compared(input, schedule.now(), (reporting) =>
			client.data.query(fitnessAnalyticsTotalsRecipe({ ...input, reporting })),
		),
	{ cancelOnUnmount: true, refreshWhile: ({ data }) => data.current.processing === "pending" },
);

export const analyticsTrendQuery = createRyotQuery<
	AnalyticsInput & Pick<Parameters<typeof fitnessAnalyticsTrendRecipe>[0], "metric">,
	Compared<AnalyticsTrend>
>(
	({ input, client, schedule }) =>
		compared(input, schedule.now(), (reporting) =>
			client.data.query(fitnessAnalyticsTrendRecipe({ ...input, reporting })),
		),
	{ cancelOnUnmount: true, refreshWhile: ({ data }) => data.current.processing === "pending" },
);
export const workoutStartsByHourQuery = createRyotQuery<AnalyticsInput, Reported<WorkoutHours>>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = reportingExecution(input.selection, { now, timeZone: input.timeZone });
			const result = yield* client.data.query(
				fitnessWorkoutStartsByHourRecipe({ ...input, reporting: reporting.resolved }),
			);
			return { ...result, reporting };
		}),
	{ cancelOnUnmount: true },
);
export const analyticsConsistencyQuery = createRyotQuery<
	AnalyticsInput,
	Reported<AnalyticsTrend> & { readonly clipped: boolean }
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const bounded = consistencySelection(input, now);
			const reporting = reportingExecution(bounded.selection, { now, timeZone: input.timeZone });
			const result = yield* client.data.query(
				fitnessAnalyticsTrendRecipe({
					...input,
					metric: "workouts",
					reporting: reporting.resolved,
				}),
			);
			return { ...result, reporting, clipped: bounded.clipped };
		}),
	{ cancelOnUnmount: true },
);

export const analyticsWorkoutsQuery = createRyotQuery<
	PageInput<AnalyticsInput>,
	Reported<AnalyticsWorkouts>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const reporting = pagedReporting(input, schedule.now());
			const result = yield* client.data.query(
				fitnessAnalyticsWorkoutsRecipe({
					...input,
					reporting: reporting.resolved,
					...(input.page == null ? {} : { after: input.page.after }),
				}),
			);
			return { ...result, reporting };
		}),
	{ cancelOnUnmount: true },
);
export const measurementTrendQuery = createRyotQuery<
	{ readonly metricId: string } & Omit<AnalyticsInput, "filter">,
	Compared<MeasurementTrend>
>(
	({ input, client, schedule }) =>
		compared(input, schedule.now(), (reporting) =>
			client.data.query(fitnessMeasurementTrendRecipe({ ...input, reporting })),
		),
	{ cancelOnUnmount: true },
);
export const analyticsRankingQuery = createRyotQuery<
	PageInput<AnalyticsInput & Pick<Parameters<typeof historicalFitnessRankingRecipe>[0], "kind">>,
	Reported<AnalyticsRanking>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const reporting = pagedReporting(input, schedule.now());
			const result = yield* client.data.query(
				historicalFitnessRankingRecipe({
					...input,
					reporting: reporting.resolved,
					...(input.page == null ? {} : { after: input.page.after }),
				}),
			);
			return { ...result, reporting };
		}),
	{ cancelOnUnmount: true },
);
export const measurementReadingsQuery = createRyotQuery<
	PageInput<{ readonly metricId: string } & Omit<AnalyticsInput, "filter">>,
	Reported<MeasurementReadings>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const reporting = pagedReporting(input, schedule.now());
			const result = yield* client.data.query(
				fitnessMeasurementReadingsRecipe({
					...input,
					reporting: reporting.resolved,
					...(input.page == null ? {} : { after: input.page.after }),
				}),
			);
			return { ...result, reporting };
		}),
	{ cancelOnUnmount: true },
);
export const analyticsMeasurementMetricsQuery = createRyotQuery<
	PageInput<Omit<AnalyticsInput, "filter">>,
	Reported<MeasurementMetrics>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const reporting = pagedReporting(input, schedule.now());
			const range = reporting.resolved.current;
			const result = yield* client.data.query(
				measurementSummaryRecipe({
					reference: input.reference,
					...(input.page == null ? {} : { after: input.page.after }),
					...(range === null ? {} : { rangeEnd: range.endAt, rangeStart: range.startAt }),
				}),
			);
			return { ...result, reporting };
		}),
	{ cancelOnUnmount: true },
);
