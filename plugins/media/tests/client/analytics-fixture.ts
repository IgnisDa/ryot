import { Result } from "@ryot-app/plugin-client-sdk/effect";
import { type Reported, reportingExecution } from "@ryot-app/plugin-client-sdk/plugin";
import { table } from "@ryot-app/plugin-kit/ryotql";

import type {
	AnalyticsInput,
	MediaAnalyticsProcessing,
	MediaAnalyticsSummary,
} from "../../client/analytics/model";
import { consumptionMeasures, mediaAnalyticsSummaryRecipe } from "../../shared/analytics-recipes";

type Row = Readonly<Record<string, unknown>>;
type Period = {
	readonly activeDays?: number;
	readonly types?: readonly Row[];
	readonly reviews?: readonly Row[];
};

export const zeroMeasures = Object.fromEntries(
	Object.keys(consumptionMeasures(table("event", "fixture"))).map((key) => [key, 0]),
);

export const analyticsTypeRow = (mediaType: string, label: string, values: Row = {}): Row => ({
	label,
	mediaType,
	activeDays: 0,
	distinctTitles: 0,
	...zeroMeasures,
	...values,
});

export const analyticsReviewRow = (mediaType: string, label: string, values: Row = {}): Row => ({
	label,
	rated: 0,
	mediaType,
	reviews: 0,
	averageRating: null,
	...values,
});

const defaultTypes = [
	analyticsTypeRow("book", "Book"),
	analyticsTypeRow("show-episode", "Show episode"),
];
const aggregate = (items: readonly Row[]) => ({
	items,
	type: "aggregate",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

export const analyticsSummary = (
	input: AnalyticsInput,
	options: {
		readonly now?: number;
		readonly current?: Period;
		readonly previous?: Period;
		readonly unknownDate?: number;
		readonly processing?: MediaAnalyticsProcessing;
	} = {},
): Reported<MediaAnalyticsSummary> => {
	const now = options.now ?? Date.parse("2026-11-01T18:00:00Z");
	const period = (prefix: string, values: Period = {}) => ({
		[`${prefix}Reviews`]: aggregate(values.reviews ?? []),
		[`${prefix}Types`]: aggregate(values.types ?? defaultTypes),
		[`${prefix}ActiveDays`]: aggregate([{ activeDays: values.activeDays ?? 0 }]),
	});
	const reporting = reportingExecution(input.selection, { now, timeZone: input.timeZone });
	const summary = Result.getOrThrow(
		mediaAnalyticsSummaryRecipe({ ...input, reporting: reporting.resolved }).decode({
			data: {
				...period("current", options.current),
				...period("previous", options.previous),
				undated: aggregate([{ count: options.unknownDate ?? 0 }]),
				processing: aggregate([
					{
						failed: options.processing === "failed" ? 1 : 0,
						pending: options.processing === "pending" ? 1 : 0,
					},
				]),
			},
		}),
	);
	return { ...summary, reporting };
};
