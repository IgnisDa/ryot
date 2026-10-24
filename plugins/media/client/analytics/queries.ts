import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	createRyotQuery,
	nextPageCursor,
	PaginationError,
} from "@ryot-app/plugin-client-sdk/react";

import {
	mediaAnalyticsConsistencyRecipe,
	mediaAnalyticsHoursRecipe,
	type MediaAnalyticsPeriods,
	mediaAnalyticsPeriods,
	mediaAnalyticsRankingRecipe,
	mediaAnalyticsRecordsRecipe,
	mediaAnalyticsStatsRecipe,
	mediaAnalyticsTrendRecipe,
} from "../../shared/analytics-recipes";
import { mediaConsumptionReportRecipe } from "../../shared/consumption-recipes";
import {
	type AnalyticsCalendarInput,
	type AnalyticsInput,
	analyticsWindow,
	type AnalyticsWindowInput,
	calendarReportingExecution,
	comparisonWindow,
	extraPreviousWindow,
	type MediaAnalyticsConsistency,
	type MediaAnalyticsHours,
	type MediaAnalyticsRanking,
	type MediaAnalyticsRecords,
	type MediaAnalyticsStats,
	type MediaAnalyticsTrend,
	type MediaConsumptionReport,
	type Reported,
	type ReportingExecution,
	reportingExecution,
} from "./model";

export type AnalyticsPageInput<Input> = Input & { readonly page?: AnalyticsPageParam };
export type AnalyticsPageParam = null | {
	readonly after: string;
	readonly anchorDate: string;
	readonly periods: MediaAnalyticsPeriods;
};
export const analyticsPageInput = <Input>(
	input: Input,
	page: AnalyticsPageParam,
): AnalyticsPageInput<Input> => ({ ...input, page });
type CursorPage = {
	readonly reporting: ReportingExecution;
	readonly pageInfo: MediaAnalyticsRecords["pageInfo"];
};
export const nextAnalyticsPage = (
	page: CursorPage,
	param: AnalyticsPageParam = null,
	pages: readonly CursorPage[] = [],
): AnalyticsPageParam => {
	const after = nextPageCursor(page);
	if (
		after !== null &&
		(param?.after === after ||
			pages.slice(0, -1).some((previous) => nextPageCursor(previous) === after))
	) {
		throw new PaginationError({ reason: "cursor-did-not-advance" });
	}
	return after === null
		? null
		: {
				after,
				anchorDate: page.reporting.anchorDate,
				periods: mediaAnalyticsPeriods(page.reporting.resolved),
			};
};

export const mediaAnalyticsReportQuery = createRyotQuery<
	AnalyticsInput,
	Reported<MediaConsumptionReport>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = reportingExecution(input, now);
			const report = yield* client.data.query(mediaConsumptionReportRecipe({ ...input, now }));
			return { ...report, reporting };
		}),
	{ cancelOnUnmount: true, refreshWhile: ({ data }) => data.processing === "pending" },
);

export const mediaAnalyticsStatsQuery = createRyotQuery<
	AnalyticsCalendarInput,
	Reported<MediaAnalyticsStats>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = calendarReportingExecution(input, now);
			const stats = yield* client.data.query(mediaAnalyticsStatsRecipe({ ...input, now }));
			return { ...stats, reporting };
		}),
	{ cancelOnUnmount: true },
);
export type AnalyticsTrendQueryInput = AnalyticsWindowInput & { readonly endCursor?: string };
export type MediaAnalyticsTrendPage = Reported<{
	readonly current: MediaAnalyticsTrend;
	readonly previous: null | MediaAnalyticsTrend;
	readonly window: ReturnType<typeof analyticsWindow>;
}>;
export const mediaAnalyticsTrendQuery = createRyotQuery<
	AnalyticsTrendQueryInput,
	MediaAnalyticsTrendPage
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = calendarReportingExecution(input, now, input.anchorDate);
			const window = analyticsWindow(reporting, "trend", input.endCursor);
			const previous = comparisonWindow(reporting, window);
			const extra = extraPreviousWindow(reporting, window, previous);
			const results = yield* Effect.all(
				{
					current: client.data.query(
						mediaAnalyticsTrendRecipe({ ...input, now, window: window.period }),
					),
					extra:
						extra === null
							? Effect.succeed(null)
							: client.data.query(
									mediaAnalyticsTrendRecipe({ ...input, now, window: extra, period: "previous" }),
								),
					previous:
						previous === null
							? Effect.succeed(null)
							: client.data.query(
									mediaAnalyticsTrendRecipe({
										...input,
										now,
										window: previous,
										period: "previous",
									}),
								),
				},
				{ concurrency: 2 },
			);
			return {
				window,
				reporting,
				current: results.current,
				previous:
					results.previous === null || results.extra === null
						? results.previous
						: {
								...results.previous,
								items: [...results.previous.items, ...results.extra.items],
								period: {
									...results.previous.period,
									endAt: results.extra.period.endAt,
									endDate: results.extra.period.endDate,
								},
								pageInfo: {
									limit: 1000,
									hasMore:
										(results.previous.pageInfo?.hasMore ?? false) ||
										(results.extra.pageInfo?.hasMore ?? false),
								},
							},
			};
		}),
	{ cancelOnUnmount: true },
);
export const mediaAnalyticsHoursQuery = createRyotQuery<
	AnalyticsCalendarInput,
	Reported<MediaAnalyticsHours>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = calendarReportingExecution(input, now);
			const hours = yield* client.data.query(mediaAnalyticsHoursRecipe({ ...input, now }));
			return { ...hours, reporting };
		}),
	{ cancelOnUnmount: true },
);
export type MediaAnalyticsConsistencyPage = Reported<
	MediaAnalyticsConsistency & { readonly window: ReturnType<typeof analyticsWindow> }
>;
export const mediaAnalyticsConsistencyQuery = createRyotQuery<
	AnalyticsTrendQueryInput,
	MediaAnalyticsConsistencyPage
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = calendarReportingExecution(input, now, input.anchorDate);
			const window = analyticsWindow(reporting, "daily", input.endCursor);
			const consistency = yield* client.data.query(
				mediaAnalyticsConsistencyRecipe({ ...input, now, window: window.period }),
			);
			return { ...consistency, window, reporting };
		}),
	{ cancelOnUnmount: true },
);

export type AnalyticsRankingInput = AnalyticsPageInput<
	Pick<MediaConsumptionReport, "processing"> &
		Omit<Parameters<typeof mediaAnalyticsRankingRecipe>[0], "now" | "after">
>;
export const mediaAnalyticsRankingQuery = createRyotQuery<
	AnalyticsRankingInput,
	Reported<MediaAnalyticsRanking>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting =
				input.page == null
					? reportingExecution(input, now)
					: calendarReportingExecution(
							{ ...input, periods: input.page.periods },
							now,
							input.page.anchorDate,
						);
			const ranking = yield* client.data.query(
				mediaAnalyticsRankingRecipe({
					...input,
					now: reporting.now,
					selection: reporting.selection,
					...(input.page == null ? {} : { after: input.page.after }),
				}),
			);
			return { ...ranking, reporting };
		}),
	{ cancelOnUnmount: true },
);
export type AnalyticsRecordsInput = AnalyticsPageInput<
	Pick<MediaConsumptionReport, "processing"> &
		Omit<Parameters<typeof mediaAnalyticsRecordsRecipe>[0], "now" | "after">
>;
export const mediaAnalyticsRecordsQuery = createRyotQuery<
	AnalyticsRecordsInput,
	Reported<MediaAnalyticsRecords>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting =
				input.page == null
					? reportingExecution(input, now)
					: calendarReportingExecution(
							{ ...input, periods: input.page.periods },
							now,
							input.page.anchorDate,
						);
			const records = yield* client.data.query(
				mediaAnalyticsRecordsRecipe({
					...input,
					now: reporting.now,
					selection: reporting.selection,
					...(input.page == null ? {} : { after: input.page.after }),
				}),
			);
			return { ...records, reporting };
		}),
	{ cancelOnUnmount: true },
);
