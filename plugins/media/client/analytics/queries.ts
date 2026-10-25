import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { type Reported, reportingExecution } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery, type ReportingPageParam } from "@ryot-app/plugin-client-sdk/react";

import {
	mediaAnalyticsHoursRecipe,
	mediaAnalyticsRankingRecipe,
	mediaAnalyticsRecordsRecipe,
	mediaAnalyticsSummaryRecipe,
	mediaAnalyticsTrendRecipe,
} from "../../shared/analytics-recipes";
import {
	type AnalyticsInput,
	consistencySelection,
	type MediaAnalyticsHours,
	type MediaAnalyticsProcessing,
	type MediaAnalyticsRanking,
	type MediaAnalyticsRecords,
	type MediaAnalyticsSummary,
	type MediaAnalyticsTrend,
} from "./model";

export type AnalyticsPageInput<Input> = Input & { readonly page?: ReportingPageParam };
export const analyticsPageInput = <Input>(
	input: Input,
	page: ReportingPageParam,
): AnalyticsPageInput<Input> => ({ ...input, page });

/** Dependent inputs carry the summary's processing state so they reload when it settles. */
export type ChartInput = AnalyticsInput & {
	readonly mediaType?: string;
	readonly processing: MediaAnalyticsProcessing;
};

export const mediaAnalyticsSummaryQuery = createRyotQuery<
	AnalyticsInput,
	Reported<MediaAnalyticsSummary>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = reportingExecution(input.selection, { now, timeZone: input.timeZone });
			const summary = yield* client.data.query(mediaAnalyticsSummaryRecipe({ ...input, now }));
			return { ...summary, reporting };
		}),
	{ cancelOnUnmount: true, refreshWhile: ({ data }) => data.processing === "pending" },
);

export const mediaAnalyticsTrendQuery = createRyotQuery<ChartInput, Reported<MediaAnalyticsTrend>>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = reportingExecution(input.selection, { now, timeZone: input.timeZone });
			const trend = yield* client.data.query(mediaAnalyticsTrendRecipe({ ...input, now }));
			return { ...trend, reporting };
		}),
	{ cancelOnUnmount: true },
);

export const mediaAnalyticsConsistencyQuery = createRyotQuery<
	ChartInput,
	Reported<MediaAnalyticsTrend> & { readonly clipped: boolean }
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const { clipped, selection } = consistencySelection(input, now);
			const reporting = reportingExecution(selection, { now, timeZone: input.timeZone });
			const trend = yield* client.data.query(
				mediaAnalyticsTrendRecipe({ ...input, now, selection }),
			);
			return { ...trend, clipped, reporting };
		}),
	{ cancelOnUnmount: true },
);

export const mediaAnalyticsHoursQuery = createRyotQuery<
	ChartInput,
	Reported<{ readonly hours: MediaAnalyticsHours }>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = reportingExecution(input.selection, { now, timeZone: input.timeZone });
			const hours = yield* client.data.query(mediaAnalyticsHoursRecipe({ ...input, now }));
			return { hours, reporting };
		}),
	{ cancelOnUnmount: true },
);

export type AnalyticsRankingInput = AnalyticsPageInput<
	ChartInput & Omit<Parameters<typeof mediaAnalyticsRankingRecipe>[0], "now" | "after">
>;
export const mediaAnalyticsRankingQuery = createRyotQuery<
	AnalyticsRankingInput,
	Reported<MediaAnalyticsRanking>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = reportingExecution(input.page?.selection ?? input.selection, {
				now,
				timeZone: input.timeZone,
			});
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
	ChartInput & Omit<Parameters<typeof mediaAnalyticsRecordsRecipe>[0], "now" | "after">
>;
export const mediaAnalyticsRecordsQuery = createRyotQuery<
	AnalyticsRecordsInput,
	Reported<MediaAnalyticsRecords>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const now = schedule.now();
			const reporting = reportingExecution(input.page?.selection ?? input.selection, {
				now,
				timeZone: input.timeZone,
			});
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
