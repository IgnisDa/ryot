import {
	createComparedQuery,
	createConsistencyQuery,
	createReportedPageQuery,
	createReportedQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { reportingArguments } from "@ryot-app/plugin-client-sdk/ryotql";

import {
	type FitnessAnalyticsMetric,
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
const filteredArguments = (input: AnalyticsInput) => ({
	filterId: input.filter?.id,
	filterKind: input.filter?.kind ?? "exercises",
});
export const analyticsSummaryQuery = createComparedQuery<AnalyticsInput, AnalyticsTotals>(
	({ input, query, selection, comparison }) =>
		query(
			fitnessAnalyticsTotalsRecipe({ reference: input.reference }),
			{ ...reportingArguments(selection, comparison), ...filteredArguments(input) },
			undefined,
			(data) => data,
		),
);

export const analyticsTrendQuery = createComparedQuery<
	AnalyticsInput & { readonly metric: FitnessAnalyticsMetric },
	AnalyticsTrend
>(({ input, query, selection, comparison }) =>
	query(
		fitnessAnalyticsTrendRecipe({ reference: input.reference }),
		{
			...reportingArguments(selection, comparison),
			...filteredArguments(input),
			metric: input.metric,
		},
		undefined,
		(data, reporting) => ({
			...data,
			metric: input.metric,
			grouping: reporting.grouping,
			period: comparison === "previous" ? reporting.previous : reporting.current,
		}),
	),
);

export const workoutStartsByHourQuery = createReportedQuery<AnalyticsInput, WorkoutHours>(
	({ input, query, selection, comparison }) =>
		query(
			fitnessWorkoutStartsByHourRecipe({ reference: input.reference }),
			{ ...reportingArguments(selection, comparison), ...filteredArguments(input) },
			undefined,
			(data) => data,
		),
);

export const analyticsConsistencyQuery = createConsistencyQuery<AnalyticsInput, AnalyticsTrend>(
	({ input, query, selection, comparison }) =>
		query(
			fitnessAnalyticsTrendRecipe({ reference: input.reference }),
			{
				...reportingArguments(selection, comparison),
				consistency: true,
				...filteredArguments(input),
				metric: "workouts",
			},
			undefined,
			(data, reporting) => ({
				...data,
				metric: "workouts" as const,
				grouping: reporting.grouping,
				period: comparison === "previous" ? reporting.previous : reporting.current,
			}),
		),
);

export const analyticsWorkoutsQuery = createReportedPageQuery<AnalyticsInput, AnalyticsWorkouts>(
	({ input, after, query, selection, comparison }) =>
		query(
			fitnessAnalyticsWorkoutsRecipe({ reference: input.reference }),
			{ ...reportingArguments(selection, comparison), ...filteredArguments(input) },
			{ pages: { workouts: { after } } },
			(data) => data,
		),
);

export const measurementTrendQuery = createComparedQuery<MeasurementInput, MeasurementTrend>(
	({ input, query, selection, comparison }) =>
		query(
			fitnessMeasurementTrendRecipe({ reference: input.reference }),
			{ ...reportingArguments(selection, comparison), metricId: input.metricId },
			undefined,
			(data, reporting) => ({
				points: data.points,
				metricId: input.metricId,
				grouping: reporting.grouping,
				period: comparison === "previous" ? reporting.previous : reporting.current,
			}),
		),
);

export const analyticsRankingQuery = createReportedPageQuery<
	AnalyticsInput & { readonly kind: "targets" | "equipment" | "exercises" },
	AnalyticsRanking
>(({ input, after, query, selection, comparison }) =>
	query(
		historicalFitnessRankingRecipe({ reference: input.reference }),
		{ ...reportingArguments(selection, comparison), ...filteredArguments(input), kind: input.kind },
		{ pages: { [input.kind]: { after } } },
		(data) => data,
	),
);

export const measurementReadingsQuery = createReportedPageQuery<
	MeasurementInput,
	MeasurementReadings
>(({ input, after, query, selection, comparison }) =>
	query(
		fitnessMeasurementReadingsRecipe({ reference: input.reference }),
		{ ...reportingArguments(selection, comparison), metricId: input.metricId },
		{ pages: { readings: { after } } },
		(data) => data,
	),
);

export const analyticsMeasurementMetricsQuery = createReportedPageQuery<
	Omit<AnalyticsInput, "filter">,
	MeasurementMetrics
>(({ input, after, query, selection }) =>
	query(
		measurementSummaryRecipe({ reference: input.reference }),
		reportingArguments(selection),
		{ pages: { metrics: { after } } },
		(data) => data,
	),
);
