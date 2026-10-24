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
import { measurementPeriod, type RangeKey, seriesWindow } from "./model";

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
	| { readonly timeZone: string; readonly range: Exclude<RangeKey, "All"> },
	readonly MeasurementSummary[]
>(({ input, client, schedule }) =>
	Effect.suspend(() => {
		const period =
			input.range === "All"
				? null
				: measurementPeriod(
						input.range,
						DateTime.toDateUtc(DateTime.makeUnsafe(schedule.now())),
						input.timeZone,
					);
		return Effect.map(
			readCursorPages((after) =>
				client.data.query(
					measurementSummaryRecipe({
						after,
						rangeEnd: period?.endAt,
						rangeStart: period?.startAt,
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
		readonly timeZone: string;
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
				chunk(input.metricIds, MEASUREMENT_SERIES_BATCH_SIZE),
				(metricIds) =>
					client.data.query(
						measurementSeriesRecipe({
							...window,
							metricIds,
							timeZone: input.timeZone,
							reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
						}),
					),
				{ concurrency: 4 },
			),
			(batches) => ({ window, series: batches.flat() }),
		);
	}),
);

export const readingsQuery = createRyotQuery<
	{ readonly range: RangeKey; readonly timeZone: string; readonly after: string | undefined },
	MeasurementLogPage
>(({ input, client, schedule }) =>
	Effect.gen(function* () {
		const period = measurementPeriod(
			input.range,
			DateTime.toDateUtc(DateTime.makeUnsafe(schedule.now())),
			input.timeZone,
		);
		const reference = client.pluginIdentity(PLUGIN_PACKAGE_ID);
		const page = yield* client.data.query(
			measurementEntryListRecipe({
				reference,
				after: input.after,
				endAt: period?.endAt,
				startAt: period?.startAt,
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
