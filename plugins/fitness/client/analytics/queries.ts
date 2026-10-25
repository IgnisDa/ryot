import {
	createComparedQuery,
	createConsistencyQuery,
	createReportedPageQuery,
	createReportedQuery,
} from "@ryot-app/plugin-client-sdk/react";

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
import type {
	AnalyticsInput,
	AnalyticsRanking,
	AnalyticsTotals,
	AnalyticsTrend,
	AnalyticsWorkouts,
	MeasurementMetrics,
	MeasurementReadings,
	MeasurementTrend,
	WorkoutHours,
} from "./reporting-model";

type MeasurementInput = { readonly metricId: string } & Omit<AnalyticsInput, "filter">;

export const analyticsSummaryQuery = createComparedQuery<AnalyticsInput, AnalyticsTotals>(
	({ input, client, reporting }) =>
		client.data.query(fitnessAnalyticsTotalsRecipe({ ...input, reporting })),
	{ refreshWhile: ({ data }) => data.current.processing === "pending" },
);

export const analyticsTrendQuery = createComparedQuery<
	AnalyticsInput & Pick<Parameters<typeof fitnessAnalyticsTrendRecipe>[0], "metric">,
	AnalyticsTrend
>(
	({ input, client, reporting }) =>
		client.data.query(fitnessAnalyticsTrendRecipe({ ...input, reporting })),
	{ refreshWhile: ({ data }) => data.current.processing === "pending" },
);

export const workoutStartsByHourQuery = createReportedQuery<AnalyticsInput, WorkoutHours>(
	({ input, client, reporting }) =>
		client.data.query(fitnessWorkoutStartsByHourRecipe({ ...input, reporting })),
);

export const analyticsConsistencyQuery = createConsistencyQuery<AnalyticsInput, AnalyticsTrend>(
	({ input, client, reporting }) =>
		client.data.query(fitnessAnalyticsTrendRecipe({ ...input, reporting, metric: "workouts" })),
);

export const analyticsWorkoutsQuery = createReportedPageQuery<AnalyticsInput, AnalyticsWorkouts>(
	({ input, after, client, reporting }) =>
		client.data.query(fitnessAnalyticsWorkoutsRecipe({ ...input, after, reporting })),
);

export const measurementTrendQuery = createComparedQuery<MeasurementInput, MeasurementTrend>(
	({ input, client, reporting }) =>
		client.data.query(fitnessMeasurementTrendRecipe({ ...input, reporting })),
);

export const analyticsRankingQuery = createReportedPageQuery<
	AnalyticsInput & Pick<Parameters<typeof historicalFitnessRankingRecipe>[0], "kind">,
	AnalyticsRanking
>(({ input, after, client, reporting }) =>
	client.data.query(historicalFitnessRankingRecipe({ ...input, after, reporting })),
);

export const measurementReadingsQuery = createReportedPageQuery<
	MeasurementInput,
	MeasurementReadings
>(({ input, after, client, reporting }) =>
	client.data.query(fitnessMeasurementReadingsRecipe({ ...input, after, reporting })),
);

export const analyticsMeasurementMetricsQuery = createReportedPageQuery<
	Omit<AnalyticsInput, "filter">,
	MeasurementMetrics
>(({ input, after, client, reporting }) =>
	client.data.query(
		measurementSummaryRecipe({
			after,
			reference: input.reference,
			...(reporting.current === null
				? {}
				: { rangeEnd: reporting.current.endAt, rangeStart: reporting.current.startAt }),
		}),
	),
);
