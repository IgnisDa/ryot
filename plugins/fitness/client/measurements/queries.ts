import { Effect } from "@ryot-app/client-sdk/effect";
import { createRyotQuery } from "@ryot-app/client-sdk/react";

import {
	MEASUREMENT_SERIES_BATCH_SIZE,
	measurementSeriesRecipe,
	measurementSummaryRecipe,
	type MeasurementSeries,
	type MeasurementSummary,
} from "../../shared/measurement-recipes";
import { measurementReadingListRecipe } from "../../shared/query-recipes";
import { chunk, type MeasurementReading } from "./model";

const READING_PAGE_SIZE = 100;

export const summaryQuery = createRyotQuery<
	{ readonly rangeStart: string },
	readonly MeasurementSummary[]
>(({ input, client }) => client.data.query(measurementSummaryRecipe(input)));

export const seriesQuery = createRyotQuery<
	{
		readonly endAt: string;
		readonly startAt: string;
		readonly bucket: "day" | "week";
		readonly metricIds: readonly string[];
	},
	readonly MeasurementSeries[]
>(({ input, client }) =>
	Effect.map(
		Effect.forEach(
			chunk(input.metricIds, MEASUREMENT_SERIES_BATCH_SIZE),
			(metricIds) => client.data.query(measurementSeriesRecipe({ ...input, metricIds })),
			{ concurrency: 4 },
		),
		(batches) => batches.flat(),
	),
);

export const readingsQuery = createRyotQuery<
	{ readonly startAt: string; readonly pages: number },
	{ readonly hasMore: boolean; readonly items: readonly MeasurementReading[] }
>(({ input, client }) =>
	Effect.gen(function* () {
		const items: MeasurementReading[] = [];
		let after: string | undefined;
		let hasMore = false;
		for (let page = 0; page < input.pages; page += 1) {
			const result = yield* client.data.query(
				measurementReadingListRecipe({ after, startAt: input.startAt, limit: READING_PAGE_SIZE }),
			);
			items.push(...result.items);
			hasMore = result.pageInfo.hasMore;
			after = result.pageInfo.nextCursor ?? undefined;
			if (!hasMore) {
				break;
			}
		}
		return { items, hasMore };
	}),
);
