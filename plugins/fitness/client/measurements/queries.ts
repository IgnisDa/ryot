import { readCursorPages } from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { chunk } from "../../shared/collections";
import {
	MEASUREMENT_SERIES_BATCH_SIZE,
	type MeasurementEntryReading,
	measurementPageReadingsRecipe,
	type MeasurementSeries,
	measurementSeriesRecipe,
	type MeasurementSummary,
	measurementSummaryRecipe,
} from "../../shared/measurement-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	measurementEntryListRecipe,
	type MeasurementEntryListResult,
} from "../../shared/query-recipes";
import { type RangeKey, rangeStartAt, seriesWindow } from "./model";

const READING_PAGE_SIZE = 100;

export type MeasurementLogEntry = MeasurementEntryListResult["items"][number] & {
	readonly readings: readonly MeasurementEntryReading[];
};

type MeasurementLogPage = Omit<MeasurementEntryListResult, "items"> & {
	readonly items: readonly MeasurementLogEntry[];
};

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
	{ readonly range: RangeKey; readonly after: string | undefined },
	MeasurementLogPage
>(({ input, client, schedule }) =>
	Effect.gen(function* () {
		const startAt = rangeStartAt(
			input.range,
			DateTime.toDateUtc(DateTime.makeUnsafe(schedule.now())),
		);
		const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
		const page = yield* client.data.query(
			measurementEntryListRecipe({
				startAt,
				reference,
				after: input.after,
				limit: READING_PAGE_SIZE,
			}),
		);
		const { items: readings } = yield* readCursorPages((after) =>
			client.data.query(
				measurementPageReadingsRecipe({
					after,
					reference,
					entryIds: page.items.map(({ id }) => id),
				}),
			),
		);
		const items = page.items.map((entry) => ({
			...entry,
			readings: readings.filter(({ entryId }) => entryId === entry.id),
		}));
		return { ...page, items };
	}),
);
