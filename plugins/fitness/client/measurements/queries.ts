import { readCursorPages } from "@ryot-app/plugin-client-sdk";
import { Array, DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import type { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { reportingArguments } from "@ryot-app/plugin-client-sdk/ryotql";

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
import { measurementSelection, type RangeKey, seriesWindow } from "./model";

const READING_PAGE_SIZE = 100;

export type MeasurementLogEntry = MeasurementEntryListResult["items"][number] & {
	readonly readings: readonly MeasurementEntryReading[];
};

type MeasurementLogPage = Omit<MeasurementEntryListResult, "items"> & {
	readonly items: readonly MeasurementLogEntry[];
};

type MeasurementSeriesResult = {
	readonly series: readonly MeasurementSeries[];
	readonly window: ReturnType<typeof seriesWindow>;
};

export const summaryQuery = createRyotQuery<
	| { readonly range: "All" }
	| { readonly timeZone: TimeZone; readonly range: Exclude<RangeKey, "All"> },
	readonly MeasurementSummary[]
>(({ input, client }) =>
	Effect.map(
		readCursorPages((after) =>
			client.data.query(
				measurementSummaryRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
				reportingArguments(measurementSelection(input.range)),
				{ pages: { metrics: { after } } },
			),
		),
		({ items }) => items,
	),
);
export const seriesQuery = createRyotQuery<
	{
		readonly range: RangeKey;
		readonly timeZone: TimeZone;
		readonly metricIds: readonly string[];
		readonly firstReadings: readonly Pick<MeasurementSummary, "firstAt">[];
	},
	MeasurementSeriesResult
>(({ input, client, schedule }) =>
	Effect.suspend(() => {
		const window = seriesWindow(
			input.range,
			DateTime.toDateUtc(DateTime.makeUnsafe(schedule.now())),
			input.firstReadings,
			input.timeZone,
		);
		return Effect.map(
			Effect.forEach(
				Array.chunksOf(input.metricIds, MEASUREMENT_SERIES_BATCH_SIZE),
				(metricIds) =>
					client.data.query(
						measurementSeriesRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
						{
							...reportingArguments(measurementSelection(input.range)),
							metricIds,
							firstAt: input.firstReadings
								.flatMap(({ firstAt }) => (firstAt === null ? [] : [firstAt]))
								.sort()[0],
						},
					),
				{ concurrency: 4 },
			),
			(batches) => ({ window, series: batches.flat() }),
		);
	}),
);

export const readingsQuery = createRyotQuery<
	{ readonly range: RangeKey; readonly timeZone: TimeZone; readonly after: string | undefined },
	MeasurementLogPage
>(({ input, client }) =>
	Effect.gen(function* () {
		const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
		const page = yield* client.data.query(
			measurementEntryListRecipe({ reference: reference }),
			reportingArguments(measurementSelection(input.range)),
			{ pages: { entries: { after: input.after, limit: READING_PAGE_SIZE } } },
		);
		const { items: readings } = yield* readCursorPages((after) =>
			client.data.query(
				measurementPageReadingsRecipe({ reference: reference }),
				{ entryIds: page.items.map(({ id }) => id) },
				{ pages: { readings: { after: after } } },
			),
		);
		const items = page.items.map((entry) => ({
			...entry,
			readings: readings.filter(({ entryId }) => entryId === entry.id),
		}));
		return { ...page, items };
	}),
);
