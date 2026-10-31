import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	createConsistencyQuery,
	createReportedPageQuery,
	createReportedQuery,
} from "@ryot-app/plugin-client-sdk/react";

import {
	mediaAnalyticsHoursRecipe,
	mediaAnalyticsRankingRecipe,
	mediaAnalyticsRecordsRecipe,
	mediaAnalyticsSummaryRecipe,
	mediaAnalyticsTrendRecipe,
} from "../../shared/analytics-recipes";
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
>(({ input, client, reporting }) =>
	client.data.query(mediaAnalyticsSummaryRecipe({ ...input, reporting })),
);

export const mediaAnalyticsTrendQuery = createReportedQuery<ChartInput, MediaAnalyticsTrend>(
	({ input, client, reporting }) =>
		client.data.query(mediaAnalyticsTrendRecipe({ ...input, reporting })),
);

export const mediaAnalyticsConsistencyQuery = createConsistencyQuery<
	ChartInput,
	MediaAnalyticsTrend
>(({ input, client, reporting }) =>
	client.data.query(mediaAnalyticsTrendRecipe({ ...input, reporting })),
);

export const mediaAnalyticsHoursQuery = createReportedQuery<
	ChartInput,
	{ readonly hours: MediaAnalyticsHours }
>(({ input, client, reporting }) =>
	client.data
		.query(mediaAnalyticsHoursRecipe({ ...input, reporting }))
		.pipe(Effect.map((hours) => ({ hours }))),
);

export type AnalyticsRankingInput = ChartInput &
	Omit<Parameters<typeof mediaAnalyticsRankingRecipe>[0], "after" | "reporting">;
export const mediaAnalyticsRankingQuery = createReportedPageQuery<
	AnalyticsRankingInput,
	MediaAnalyticsRanking
>(({ input, after, client, reporting }) =>
	client.data.query(mediaAnalyticsRankingRecipe({ ...input, after, reporting })),
);

export type AnalyticsRecordsInput = ChartInput &
	Omit<Parameters<typeof mediaAnalyticsRecordsRecipe>[0], "after" | "reporting">;
export const mediaAnalyticsRecordsQuery = createReportedPageQuery<
	AnalyticsRecordsInput,
	MediaAnalyticsRecords
>(({ input, after, client, reporting }) =>
	client.data.query(mediaAnalyticsRecordsRecipe({ ...input, after, reporting })),
);
