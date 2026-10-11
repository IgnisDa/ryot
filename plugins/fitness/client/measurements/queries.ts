import { readCursorPages } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
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
import type { MeasurementReading } from "./model";

const READING_PAGE_SIZE = 100;

export const summaryQuery = createRyotQuery<
	{ readonly rangeStart: string },
	readonly MeasurementSummary[]
>(({ input, client }) =>
	Effect.map(
		readCursorPages((after) =>
			client.data.query(
				measurementSummaryRecipe({
					...input,
					after,
					reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				}),
			),
		),
		({ items }) => items,
	),
);
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
			(metricIds) =>
				client.data.query(
					measurementSeriesRecipe({
						...input,
						metricIds,
						reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
					}),
				),
			{ concurrency: 4 },
		),
		(batches) => batches.flat(),
	),
);

export const readingsQuery = createRyotQuery<
	{ readonly startAt: string; readonly pages: number },
	{ readonly hasMore: boolean; readonly items: readonly MeasurementReading[] }
>(({ input, client }) =>
	readCursorPages(
		(after) =>
			client.data.query(
				measurementReadingListRecipe({
					after,
					startAt: input.startAt,
					limit: READING_PAGE_SIZE,
					reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				}),
			),
		{ maxPages: input.pages },
	),
);
