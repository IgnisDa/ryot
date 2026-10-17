import { readCursorPages } from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { chunk } from "../../shared/collections";
import {
	MEASUREMENT_SERIES_BATCH_SIZE,
	measurementSeriesRecipe,
	measurementSummaryRecipe,
	type MeasurementSeries,
	type MeasurementSummary,
} from "../../shared/measurement-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { measurementReadingListRecipe } from "../../shared/query-recipes";
import { rangeStartAt, seriesWindow, type MeasurementReading, type RangeKey } from "./model";

const READING_PAGE_SIZE = 100;

export const summaryQuery = createRyotQuery<
	{ readonly range: RangeKey },
	readonly MeasurementSummary[]
>(({ input, client, schedule }) =>
	Effect.suspend(() => {
		const rangeStart = rangeStartAt(
			input.range,
			DateTime.toDateUtc(DateTime.makeUnsafe(schedule.now())),
		);
		return Effect.map(
			readCursorPages((after) =>
				client.data.query(
					measurementSummaryRecipe({
						after,
						rangeStart,
						reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
					}),
				),
			),
			({ items }) => items,
		);
	}),
);
export const seriesQuery = createRyotQuery<
	{
		readonly range: RangeKey;
		readonly metricIds: readonly string[];
		readonly firstReadings: readonly Pick<MeasurementSummary, "firstAt">[];
	},
	readonly MeasurementSeries[]
>(({ input, client, schedule }) =>
	Effect.suspend(() => {
		const window = seriesWindow(
			input.range,
			DateTime.toDateUtc(DateTime.makeUnsafe(schedule.now())),
			input.firstReadings,
		);
		return Effect.map(
			Effect.forEach(
				chunk(input.metricIds, MEASUREMENT_SERIES_BATCH_SIZE),
				(metricIds) =>
					client.data.query(
						measurementSeriesRecipe({
							...window,
							metricIds,
							reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
						}),
					),
				{ concurrency: 4 },
			),
			(batches) => batches.flat(),
		);
	}),
);

export const readingsQuery = createRyotQuery<
	{ readonly range: RangeKey; readonly pages: number },
	{ readonly hasMore: boolean; readonly items: readonly MeasurementReading[] }
>(({ input, client, schedule }) =>
	Effect.suspend(() => {
		const startAt = rangeStartAt(
			input.range,
			DateTime.toDateUtc(DateTime.makeUnsafe(schedule.now())),
		);
		return readCursorPages(
			(after) =>
				client.data.query(
					measurementReadingListRecipe({
						after,
						startAt,
						limit: READING_PAGE_SIZE,
						reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
					}),
				),
			{ maxPages: input.pages },
		);
	}),
);
