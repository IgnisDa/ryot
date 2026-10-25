import { formatExactValue } from "@ryot-app/plugin-client-sdk/plugin";
import { Result } from "@ryot-app/plugin-kit/effect";
import { resolveReportingSelection, TimeZone } from "@ryot-app/plugin-kit/schema";
import { describe, expect, it } from "vitest";

import {
  mediaAnalyticsHoursRecipe,
  mediaAnalyticsTrendRecipe,
} from "../../shared/analytics-recipes";
import {
  analyticsReviewRow,
  analyticsSummary,
  analyticsTypeRow,
  zeroMeasures,
} from "../../tests/client/analytics-fixture";
import {
  consistencyModel,
  hourlyModel,
  type MediaAnalyticsTrend,
  quantityValue,
  recordModel,
  reviewModel,
  summaryModel,
  trendBuckets,
} from "./model";

const input = {
  reference: { kind: "self" },
  timeZone: TimeZone.make("America/New_York"),
  selection: {
    grouping: "day",
    comparison: "previous-period",
    range: { days: 30, kind: "rolling" },
  },
} as const;
const now = Date.parse("2026-10-29T12:00:00Z");
const book = {
  activeDays: 1,
  pagesKnown: 2,
  pagesMissing: 1,
  distinctTitles: 1,
  titleCompletions: 2,
  activeObservations: 3,
  pagesRecorded: 70.125,
  pagesEstimated: 29.875,
};
const summary = (processing: "ready" | "failed" | "pending" = "ready") =>
  analyticsSummary(input, {
    now,
    processing,
    unknownDate: 2,
    current: {
      activeDays: 1,
      types: [analyticsTypeRow("book", "Book", book), analyticsTypeRow("movie", "Movie", book)],
      reviews: [
        analyticsReviewRow("person", "Person", { rated: 1, reviews: 1, averageRating: 0 }),
        analyticsReviewRow("show-episode", "Show episode", {
          rated: 2,
          reviews: 2,
          averageRating: 60,
        }),
      ],
    },
  });
const trend = (startDate = "2026-10-01", endDate = "2026-10-02"): MediaAnalyticsTrend =>
  Result.getOrThrow(
    mediaAnalyticsTrendRecipe({
      ...input,
      reporting: resolveReportingSelection(
        { grouping: "day", comparison: "none", range: { endDate, startDate, kind: "custom" } },
        { now, timeZone: input.timeZone },
      ),
    }).decode({
      data: {
        current: {
          type: "aggregate",
          pageInfo: { limit: 100, hasMore: false, nextCursor: null },
          items: [{ ...zeroMeasures, ...book, pagesKnown: 3, at: startDate }],
        },
      },
    }),
  );

describe("Media analytics presentation model", () => {
  it("preserves exact fractions, known zero, missing-only, and absent/superseded quantity distinctions", () => {
    expect(formatExactValue(70.125, "pages")).toBe("70.125 pages");
    expect(formatExactValue(null)).toBe("Unknown");
    const row = trend().current.items[0];
    if (row === undefined) {
      throw new Error("Expected a trend row");
    }
    expect(
      quantityValue([{ ...row, pagesKnown: 1, pagesRecorded: 0, pagesEstimated: 0 }], "pages"),
    ).toMatchObject({ value: 0, known: 1, missing: 1, partial: true });
    expect(quantityValue([{ ...row, pagesKnown: 0 }], "pages").value).toBeNull();
    expect(quantityValue([row], "minutes")).toMatchObject({ known: 0, missing: 0, value: null });
    expect(quantityValue([{ ...row, pagesKnown: 0, pagesSuperseded: 1 }], "pages")).toMatchObject({
      value: null,
      superseded: 1,
    });
  });
  it("keeps consumption values while processing is pending", () => {
    const model = summaryModel(summary("pending"));
    expect(model.unknownDate).toBe(2);
    expect(model.current).toMatchObject({ activeDays: 1, titleCompletions: 4 });
    expect(model.current.types[0]?.quantities.pages).toMatchObject({ value: 100, missing: 1 });
  });
  it("sums media-type rows and keeps the global active-day count", () => {
    const model = summaryModel(summary());
    expect(model.current).toMatchObject({
      activeDays: 1,
      distinctTitles: 2,
      titleCompletions: 4,
      activeObservations: 6,
    });
    expect(model.current.types[0]?.source.label).toBe("Book");
    expect(model.current.types[0]?.quantities.pages).toMatchObject({
      value: 100,
      missing: 1,
      partial: true,
      recorded: 70.125,
      estimated: 29.875,
    });
    expect(model.current.quantities.pages).toMatchObject({ value: 200, recorded: 140.25 });
    expect(model.unknownDate).toBe(2);
    expect(model.previous?.types).toHaveLength(2);
  });
  it("fills every calendar bucket of the period and zero-fills empty days", () => {
    const current = trend();
    const buckets = trendBuckets(current, current.current, "titleCompletions", input.timeZone);
    expect(buckets.map(({ date, value }) => ({ date, value }))).toEqual([
      { value: 2, date: "2026-10-01" },
      { value: 0, date: "2026-10-02" },
    ]);
    expect(trendBuckets(current, current.current, "pages", input.timeZone)[1]?.value).toBeNull();
    expect(
      consistencyModel(current, input.timeZone).map(({ date, value }) => ({ date, value })),
    ).toEqual([
      { value: 3, date: "2026-10-01" },
      { value: 0, date: "2026-10-02" },
    ]);
  });
  it("groups hours into a 24-hour grid without combining units", () => {
    const hours = Result.getOrThrow(
      mediaAnalyticsHoursRecipe({
        ...input,
        reporting: resolveReportingSelection(input.selection, { now, timeZone: input.timeZone }),
      }).decode({
        data: {
          hourly: {
            type: "aggregate",
            items: [{ ...zeroMeasures, ...book, hour: 1 }],
            pageInfo: { limit: 100, hasMore: false, nextCursor: null },
          },
        },
      }),
    );
    const model = hourlyModel(hours, "activeObservations");
    expect(model).toHaveLength(24);
    expect(model[1]?.value).toBe(3);
    expect(model[2]?.value).toBe(0);
    expect(hourlyModel(hours, "minutes")[1]?.value).toBeNull();
  });
  it("keeps zero ratings and weights the overall average by rated reviews", () => {
    const model = reviewModel(summary().current.reviews);
    expect(model).toMatchObject({ rated: 3, reviews: 3, averageRating: 40 });
    expect(model.categories).toMatchObject([
      { rated: 1, label: "Person", averageRating: 0 },
      { rated: 2, averageRating: 60, label: "Show episode" },
    ]);
    expect(reviewModel([]).averageRating).toBeNull();
  });
  it("labels item position and raw partial progress separately from immutable canonical amounts", () => {
    const row = {
      id: "item",
      name: "Anime",
      label: "Anime",
      orderKey: "item",
      entityId: "anime",
      mediaType: "anime",
      eventType: "item-complete",
      occurredAt: "2026-10-01T00:00:00Z",
      orderCreatedAt: "2026-10-01T00:00:00Z",
      facts: {
        timeSpent: 0,
        consumedItem: { position: 12, unit: "episodes" },
        sourceProgress: { percent: 50, position: 12, unit: "episodes" },
      },
      contribution: {
        titleCompletions: 0,
        episodeCompletions: 0,
        activeObservation: true,
        attribution: { kind: "unknown" },
        episodes: { recorded: 1, estimated: 0, missing: false, supersededEstimate: false },
      },
    } as const;
    const model = recordModel(row);
    expect(model.item).toBe("episodes position 12");
    expect(model.sourceProgress).toContain("not an allocated amount");
    expect(model.manualMinutes).toBe(0);
    expect(model.date).toBe("Unknown date");
  });
});
