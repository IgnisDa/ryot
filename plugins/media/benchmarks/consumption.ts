import type { PluginIdentityReference, ReportingSelection } from "@ryot-app/plugin-kit/schema";
import { TimeZone } from "@ryot-app/plugin-kit/schema";

import { mediaActivityRecipe } from "../shared/activity-recipes";
import type { ConsumptionObservation } from "../shared/consumption-allocation";
import { mediaConsumptionReportRecipe } from "../shared/consumption-recipes";

export const mediaConsumptionBenchmarkNow = Date.parse("2026-10-29T12:00:00.000Z");

export function* mediaConsumptionBenchmarkReviews() {
	for (let index = 0; index < 1000; index += 1) {
		yield {
			entitySchemaSlug: "book",
			eventSchemaSlug: "review",
			id: `media-review:${index}`,
			entityId: `media-gate:book:${index % 100}`,
			occurredAt: new Date(mediaConsumptionBenchmarkNow - (index % 730) * 86_400_000).toISOString(),
			properties: {
				text: "Retained review",
				...(index % 4 === 0 ? {} : { rating: index % 4 === 1 ? 0 : 100 }),
			},
		};
	}
}

export const mediaConsumptionBenchmarkReviewsExpected = {
	rated: 750,
	reviews: 1000,
	averageRating: 200 / 3,
};

export function* mediaConsumptionLongTitleSources(): Generator<ConsumptionObservation> {
	for (let index = 0; index < 100_000; index += 1) {
		yield {
			closesRun: false,
			entitySchemaSlug: "book",
			entityId: "media-long:book",
			eventSchemaSlug: "progress",
			id: `media-long:${String(index).padStart(6, "0")}`,
			occurredAt: new Date(mediaConsumptionBenchmarkNow - (100_000 - index) * 60_000).toISOString(),
			properties: {
				sourceRun: "長い履歴".repeat(40),
				progressPages: (index + 1) / 4,
				consumptionBasis: { unit: "pages", property: "pages" },
			},
		};
	}
}

export const mediaConsumptionLongTitleExpected = { observations: 100_000, pagesRecorded: 25_000 };

export function* mediaConsumptionBenchmarkSources(): Generator<ConsumptionObservation> {
	for (let run = 0; run < 10_000; run += 1) {
		const occurredAt = new Date(
			mediaConsumptionBenchmarkNow - (run % 730) * 86_400_000,
		).toISOString();
		let precision: Pick<ConsumptionObservation["properties"], "dateUnknown" | "calendarDate"> = {};
		if (run % 20 === 0) {
			precision = { dateUnknown: true };
		} else if (run % 3 === 0) {
			precision = { calendarDate: occurredAt.slice(0, 10) };
		}
		const source = (
			schema: string,
			suffix: string,
			eventSchemaSlug: ConsumptionObservation["eventSchemaSlug"],
			properties: ConsumptionObservation["properties"],
		): ConsumptionObservation => ({
			occurredAt,
			eventSchemaSlug,
			closesRun: false,
			entitySchemaSlug: schema,
			id: `media-gate:${run}:${suffix}`,
			entityId: `media-gate:${schema}:${run < 1100 ? 0 : run % 100}`,
			properties: { ...precision, sourceRun: `media-gate:${run}:${schema}`, ...properties },
		});
		const book = { total: 100, unit: "pages", property: "pages" } as const;
		yield source("book", "0", "progress", { progressPercent: 40, consumptionBasis: book });
		yield source("book", "1", "progress", { progressPages: 70, consumptionBasis: book });
		yield source("book", "2", "complete", { consumptionBasis: book });
		const movie = { total: 200, unit: "minutes", property: "runtime" } as const;
		yield source("movie", "3", "progress", { progressPercent: 50, consumptionBasis: movie });
		yield source("movie", "4", "progress", { timeSpent: 60.25, consumptionBasis: movie });
		yield source("movie", "5", "complete", { timeSpent: 60.25, consumptionBasis: movie });
		for (const suffix of ["6", "7"]) {
			yield source("anime", suffix, "item-complete", {
				sourceRun: `media-gate:${run}:${suffix}`,
				consumedItem: { position: 0, unit: "episodes" },
				consumptionBasis: { unit: "episodes", property: "episodes" },
			});
		}
		yield source("manga", "8", "item-complete", {
			sourceRun: `media-gate:${run}:8`,
			consumptionBasis: { unit: "chapters", property: "chapters" },
			consumedItem: { volume: 2, position: 12.5, unit: "chapters" },
		});
		yield source("manga", "9", "item-complete", {
			sourceRun: `media-gate:${run}:9`,
			consumedItem: { position: 3.5, unit: "volumes" },
			consumptionBasis: { unit: "chapters", property: "chapters" },
		});
	}
}

export const mediaConsumptionBenchmarkExpected = {
	minutesEstimated: 0,
	observations: 100_000,
	pagesRecorded: 700_000,
	pagesEstimated: 300_000,
	volumesRecorded: 10_000,
	titleCompletions: 20_000,
	minutesRecorded: 602_500,
	episodesRecorded: 20_000,
	chaptersRecorded: 10_000,
};

const selection = (range: ReportingSelection["range"]): ReportingSelection => ({
	range,
	grouping: "auto",
	comparison: "previous-period",
});

export const mediaConsumptionBenchmarkCases = (
	reference: PluginIdentityReference,
	longTitleEntityId = "media-long:book",
) => {
	const report = (range: ReportingSelection["range"]) =>
		mediaConsumptionReportRecipe({
			reference,
			selection: selection(range),
			now: mediaConsumptionBenchmarkNow,
			timeZone: TimeZone.make("America/New_York"),
		});
	return {
		allTimeTotals: report({ kind: "all-time" }),
		yearTotals: report({ kind: "custom", endDate: "2026-10-29", startDate: "2026-01-01" }),
		monthTotals: report({ kind: "custom", endDate: "2026-10-29", startDate: "2026-10-01" }),
		home: mediaActivityRecipe({
			reference,
			from: "2025-11-03T05:00:00.000Z",
			until: "2026-10-30T04:00:00.000Z",
			timeZone: TimeZone.make("America/New_York"),
		}),
		singleLongTitle: mediaConsumptionReportRecipe({
			reference,
			entityId: longTitleEntityId,
			now: mediaConsumptionBenchmarkNow,
			selection: selection({ kind: "all-time" }),
			timeZone: TimeZone.make("America/New_York"),
		}),
	};
};
