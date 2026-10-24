import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import type { ReportingSelection } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	nextPageCursor,
	PaginationError,
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
import {
	type AnalyticsInput,
	type AnalyticsRanking,
	type AnalyticsSummary,
	type AnalyticsTotals,
	type AnalyticsTrend,
	type AnalyticsWorkouts,
	consistencySelection,
	type MeasurementMetrics,
	type MeasurementReadings,
	type MeasurementTrend,
	type Reported,
	type ReportingExecution,
	reportingExecution,
	selectionForPeriod,
	type WorkoutHours,
} from "./reporting-model";

export type AnalyticsPageParam = null | {
	readonly after: string;
	readonly selection: ReportingSelection;
};
type PageInput<Input> = Input & { readonly page?: AnalyticsPageParam };
export const analyticsPageInput = <Input>(
	input: Input,
	page: AnalyticsPageParam,
): PageInput<Input> => ({ ...input, page });
type AnalyticsCursorPage = {
	readonly reporting: ReportingExecution;
	readonly pageInfo: AnalyticsWorkouts["pageInfo"];
};
export const nextAnalyticsPage = (
	page: AnalyticsCursorPage,
	param: AnalyticsPageParam = null,
	pages: readonly AnalyticsCursorPage[] = [],
): AnalyticsPageParam => {
	const after = nextPageCursor(page);
	if (
		after !== null &&
		(param?.after === after ||
			pages.slice(0, -1).some((previous) => nextPageCursor(previous) === after))
	) {
		throw new PaginationError({ reason: "cursor-did-not-advance" });
	}
	return after === null ? null : { after, selection: page.reporting.selection };
};

export const analyticsSummaryQuery = createRyotQuery<AnalyticsInput, AnalyticsSummary>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = reportingExecution(input, now);
			const previous = reporting.resolved.previous;
			const results = yield* Effect.all(
				{
					current: client.data.query(fitnessAnalyticsTotalsRecipe({ ...input, now })),
					previous:
						previous === null
							? Effect.succeed(null)
							: client.data.query(
									fitnessAnalyticsTotalsRecipe({
										...input,
										now,
										selection: selectionForPeriod(input.selection, previous),
									}),
								),
				},
				{ concurrency: 2 },
			);
			return { ...results, reporting };
		}),
	{
		cancelOnUnmount: true,
		refreshWhile: ({ data }) =>
			data.current.pendingSets > 0 || (data.previous?.pendingSets ?? 0) > 0,
	},
);

export const analyticsTotalsQuery = createRyotQuery<AnalyticsInput, Reported<AnalyticsTotals>>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = reportingExecution(input, now);
			const result = yield* client.data.query(fitnessAnalyticsTotalsRecipe({ ...input, now }));
			return { ...result, reporting };
		}),
	{ cancelOnUnmount: true, refreshWhile: ({ data }) => data.pendingSets > 0 },
);
export const analyticsTrendQuery = createRyotQuery<
	Omit<Parameters<typeof fitnessAnalyticsTrendRecipe>[0], "now">,
	Reported<AnalyticsTrend>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = reportingExecution(input, now);
			const result = yield* client.data.query(fitnessAnalyticsTrendRecipe({ ...input, now }));
			return { ...result, reporting };
		}),
	{
		cancelOnUnmount: true,
		refreshWhile: ({ data }) => data.points.some((point) => (point.pendingSets ?? 0) > 0),
	},
);
export const workoutStartsByHourQuery = createRyotQuery<AnalyticsInput, Reported<WorkoutHours>>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = reportingExecution(input, now);
			const result = yield* client.data.query(fitnessWorkoutStartsByHourRecipe({ ...input, now }));
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
			const boundedInput = { ...input, selection: bounded.selection };
			const reporting = reportingExecution(boundedInput, now);
			const result = yield* client.data.query(
				fitnessAnalyticsTrendRecipe({ ...boundedInput, now, metric: "workouts" }),
			);
			return { ...result, reporting, clipped: bounded.clipped };
		}),
	{ cancelOnUnmount: true },
);

export const analyticsWorkoutsQuery = createRyotQuery<
	PageInput<Omit<Parameters<typeof fitnessAnalyticsWorkoutsRecipe>[0], "now" | "after">>,
	Reported<AnalyticsWorkouts>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const selected = { ...input, selection: input.page?.selection ?? input.selection };
			const reporting = reportingExecution(selected, now);
			const result = yield* client.data.query(
				fitnessAnalyticsWorkoutsRecipe({
					...selected,
					now,
					...(input.page == null ? {} : { after: input.page.after }),
				}),
			);
			return { ...result, reporting };
		}),
	{ cancelOnUnmount: true },
);
export const measurementTrendQuery = createRyotQuery<
	Omit<Parameters<typeof fitnessMeasurementTrendRecipe>[0], "now">,
	Reported<MeasurementTrend>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = reportingExecution(input, now);
			const result = yield* client.data.query(fitnessMeasurementTrendRecipe({ ...input, now }));
			return { ...result, reporting };
		}),
	{ cancelOnUnmount: true },
);
export const analyticsRankingQuery = createRyotQuery<
	PageInput<Omit<Parameters<typeof historicalFitnessRankingRecipe>[0], "now" | "after">>,
	Reported<AnalyticsRanking>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const selected = { ...input, selection: input.page?.selection ?? input.selection };
			const reporting = reportingExecution(selected, now);
			const result = yield* client.data.query(
				historicalFitnessRankingRecipe({
					...selected,
					now,
					...(input.page == null ? {} : { after: input.page.after }),
				}),
			);
			return { ...result, reporting };
		}),
	{ cancelOnUnmount: true },
);
export const measurementReadingsQuery = createRyotQuery<
	PageInput<Omit<Parameters<typeof fitnessMeasurementReadingsRecipe>[0], "now" | "after">>,
	Reported<MeasurementReadings>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const selected = { ...input, selection: input.page?.selection ?? input.selection };
			const reporting = reportingExecution(selected, now);
			const result = yield* client.data.query(
				fitnessMeasurementReadingsRecipe({
					...selected,
					now,
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
			const now = schedule.now();
			const reporting = reportingExecution(
				{ ...input, selection: input.page?.selection ?? input.selection },
				now,
			);
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
