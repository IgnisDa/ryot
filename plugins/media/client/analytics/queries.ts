import {
	createConsistencyQuery,
	createReportedPageQuery,
	createReportedQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { reportingArguments } from "@ryot-app/plugin-client-sdk/ryotql";

import {
	mediaAnalyticsHoursRecipe,
	mediaAnalyticsRankingRecipe,
	mediaAnalyticsRecordsRecipe,
	mediaAnalyticsSummaryRecipe,
	mediaAnalyticsTrendRecipe,
} from "../../shared/analytics-recipes";
import type { MediaAnalyticsFilter } from "../../shared/analytics-recipes";
import type {
	AnalyticsInput,
	MediaAnalyticsHours,
	MediaAnalyticsRanking,
	MediaAnalyticsRecords,
	MediaAnalyticsSummary,
	MediaAnalyticsTrend,
} from "./model";

export type ChartInput = AnalyticsInput & { readonly mediaType?: string };

export const mediaAnalyticsSummaryQuery = createReportedQuery<
	AnalyticsInput,
	MediaAnalyticsSummary
>(({ input, query, selection }) =>
	query(
		mediaAnalyticsSummaryRecipe({ reference: input.reference }),
		{ ...reportingArguments(selection), entityId: input.entityId },
		undefined,
		(data) => data,
	),
);
const trend = (
	{
		input,
		query,
		selection,
	}: Parameters<Parameters<typeof createReportedQuery<ChartInput, MediaAnalyticsTrend>>[0]>[0],
	consistency = false,
) =>
	query(
		mediaAnalyticsTrendRecipe({ reference: input.reference }),
		{
			...reportingArguments(selection),
			consistency,
			entityId: input.entityId,
			mediaType: input.mediaType,
		},
		undefined,
		(data, reporting) => ({
			grouping: reporting.grouping,
			current: { ...data.current, period: reporting.current },
			previous:
				data.previous === null || reporting.previous === null
					? null
					: { ...data.previous, period: reporting.previous },
		}),
	);
export const mediaAnalyticsTrendQuery = createReportedQuery<ChartInput, MediaAnalyticsTrend>(trend);
export const mediaAnalyticsConsistencyQuery = createConsistencyQuery<
	ChartInput,
	MediaAnalyticsTrend
>((context) => trend(context, true));
export const mediaAnalyticsHoursQuery = createReportedQuery<
	ChartInput,
	{ readonly hours: MediaAnalyticsHours }
>(({ input, query, selection }) =>
	query(
		mediaAnalyticsHoursRecipe({ reference: input.reference }),
		{ ...reportingArguments(selection), entityId: input.entityId, mediaType: input.mediaType },
		undefined,
		(hours) => ({ hours }),
	),
);
export type AnalyticsRankingInput = ChartInput;
export const mediaAnalyticsRankingQuery = createReportedPageQuery<
	AnalyticsRankingInput,
	MediaAnalyticsRanking
>(({ input, after, query, selection }) =>
	query(
		mediaAnalyticsRankingRecipe({ reference: input.reference }),
		{ ...reportingArguments(selection), entityId: input.entityId, mediaType: input.mediaType },
		{ pages: { ranking: { after } } },
		(data) => data,
	),
);
export type AnalyticsRecordsInput = ChartInput & MediaAnalyticsFilter;
export const mediaAnalyticsRecordsQuery = createReportedPageQuery<
	AnalyticsRecordsInput,
	MediaAnalyticsRecords
>(({ input, after, query, selection }) =>
	query(
		mediaAnalyticsRecordsRecipe({ reference: input.reference }),
		{
			...reportingArguments(selection),
			hour: input.hour,
			entityId: input.entityId,
			mediaType: input.mediaType,
			activeOnly: input.activeOnly ?? false,
		},
		{ pages: { records: { after } } },
		(data) => data,
	),
);
