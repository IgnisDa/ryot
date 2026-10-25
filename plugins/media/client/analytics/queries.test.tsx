import { afterEach, describe, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { periodCaption, PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import { useReportedPages, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
  createTestRyotClock,
  disposePluginBridges,
  mountPluginPage,
  pluginContributor,
  routeLocation,
  savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, type ComponentType, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { zeroMeasures } from "../../tests/client/analytics-fixture";
import type { AnalyticsInput, MediaAnalyticsRecord } from "./model";
import {
  mediaAnalyticsConsistencyQuery,
  mediaAnalyticsHoursQuery,
  mediaAnalyticsRankingQuery,
  mediaAnalyticsRecordsQuery,
  mediaAnalyticsSummaryQuery,
  mediaAnalyticsTrendQuery,
} from "./queries";

afterEach(disposePluginBridges);
const documentText = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const input = {
  timeZone: TimeZone.make("America/New_York"),
  reference: { kind: "local", pluginId: PluginId.make("media-owner") },
  selection: {
    grouping: "day",
    comparison: "previous-period",
    range: { days: 7, kind: "rolling" },
  },
} as const;
const aggregate = (items: readonly Record<string, null | number | string>[]) => ({
  items,
  type: "aggregate" as const,
  pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});
const reportResponse = (pending = 0) => ({
  data: {
    currentTypes: aggregate([]),
    previousTypes: aggregate([]),
    currentReviews: aggregate([]),
    previousReviews: aggregate([]),
    undated: aggregate([{ count: 0 }]),
    processing: aggregate([{ pending, failed: 0 }]),
    currentActiveDays: aggregate([{ activeDays: 0 }]),
    previousActiveDays: aggregate([{ activeDays: 0 }]),
  },
});
const cursorResponse = (
  key: "ranking" | "records",
  nextCursor: null | string,
  items: readonly Record<string, JsonValue>[] = [],
) => ({
  data: {
    [key]:
      key === "ranking"
        ? {
            items,
            type: "aggregate" as const,
            pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
          }
        : {
            items,
            type: "rows" as const,
            pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
          },
  },
});

function UnmountProbe() {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button onClick={() => setVisible(false)}>Hide</button>
      {visible ? <ReportProbe /> : null}
    </>
  );
}
function ConsistencyProbe() {
  const query = useRyotQuery(mediaAnalyticsConsistencyQuery, {
    ...input,
    processing: "ready" as const,
  });
  return (
    <>
      <output>
        {query.data === undefined ? "Loading" : periodCaption(query.data.current.period)}
      </output>
      <output aria-label="Clipped">{String(query.data?.clipped ?? "None")}</output>
    </>
  );
}
function ReportProbe() {
  const query = useRyotQuery(mediaAnalyticsSummaryQuery, input);
  return (
    <>
      <button onClick={query.refetch}>Refresh report</button>
      <output>{query.data?.processing ?? "Loading"}</output>
      <output aria-label="Period">
        {query.data === undefined ? "" : periodCaption(query.data.reporting.resolved.current)}
      </output>
      <output aria-label="Previous">
        {query.data === undefined ? "" : periodCaption(query.data.reporting.resolved.previous)}
      </output>
    </>
  );
}
function RankingProbe() {
  const query = useReportedPages(mediaAnalyticsRankingQuery, {
    ...input,
    processing: "ready" as const,
  });
  return (
    <>
      <button onClick={query.fetchNextPage}>More</button>
      <button onClick={query.refetch}>Refresh pages</button>
      <output>{query.pages.length} pages</output>
      <output aria-label="Page clock">{query.pages.at(-1)?.reporting.now ?? "None"}</output>
      <output>{query.errorOperation ?? "No error"}</output>
      <button onClick={query.retry}>Retry</button>
    </>
  );
}
function RecordsProbe() {
  const [owner, setOwner] = useState("media-owner");
  const [processing, setProcessing] = useState<"ready" | "pending">("pending");
  const query = useReportedPages(mediaAnalyticsRecordsQuery, {
    ...input,
    hour: 1,
    processing,
    entityId: "original-title",
    reference: { kind: "local" as const, pluginId: PluginId.make(owner) },
  });
  return (
    <>
      <button onClick={query.fetchNextPage}>More</button>
      <button onClick={query.refetch}>Refresh pages</button>
      <button onClick={() => setOwner("media-other")}>Other owner</button>
      <button onClick={() => setProcessing("ready")}>Processing ready</button>
      <output>{query.pages.length} pages</output>
      <output aria-label="Page clock">{query.pages.at(-1)?.reporting.now ?? "None"}</output>
      <output aria-label="Source rows">
        {query.pages.flatMap((page) => page.items.map((row) => row.name)).join(",")}
      </output>
      <output>{query.errorOperation ?? "No error"}</output>
      <button onClick={query.retry}>Retry</button>
    </>
  );
}
const hourRow = { ...zeroMeasures, hour: 1, titleCompletions: 1, minutesRecorded: 2.125 };
function CoupledProbe() {
  const summary = useRyotQuery(mediaAnalyticsSummaryQuery, input);
  return (
    <>
      <output aria-label="Primary clock">{summary.data?.reporting.now ?? "None"}</output>
      {summary.data === undefined ? null : <ChartProbe processing={summary.data.processing} />}
    </>
  );
}
function ChartProbe(props: { readonly processing: "ready" | "failed" | "pending" }) {
  const chartInput = { ...input, processing: props.processing };
  const hours = useRyotQuery(mediaAnalyticsHoursQuery, chartInput);
  const trend = useRyotQuery(mediaAnalyticsTrendQuery, chartInput);
  const daily = useRyotQuery(mediaAnalyticsConsistencyQuery, chartInput);
  return (
    <output aria-label="Chart clocks">
      {[hours.data?.reporting.now, trend.data?.reporting.now, daily.data?.reporting.now]
        .map((value) => value ?? "None")
        .join(",")}
    </output>
  );
}
const monthProbe = (selected: AnalyticsInput): ComponentType =>
  function MonthProbe() {
    const summary = useRyotQuery(mediaAnalyticsSummaryQuery, selected);
    const trend = useRyotQuery(mediaAnalyticsTrendQuery, { ...selected, processing: "ready" });
    return (
      <>
        <output aria-label="Month current">
          {summary.data === undefined
            ? "None"
            : periodCaption(summary.data.reporting.resolved.current)}
        </output>
        <output aria-label="Month prior">
          {summary.data === undefined
            ? "None"
            : periodCaption(summary.data.reporting.resolved.previous)}
        </output>
        <output aria-label="Prior chart">
          {trend.data === undefined ? "None" : periodCaption(trend.data.previous?.period ?? null)}
        </output>
      </>
    );
  };
const sourceRecord = (name: string): MediaAnalyticsRecord => ({
  name,
  id: name,
  facts: {},
  orderKey: name,
  label: "Music",
  mediaType: "music",
  eventType: "complete",
  entityId: "original-title",
  occurredAt: "2026-10-29T12:00:00Z",
  orderCreatedAt: "2026-10-29T12:00:00Z",
  contribution: {
    titleCompletions: 1,
    episodeCompletions: 0,
    activeObservation: true,
    attribution: { kind: "instant", value: "2026-10-29T12:00:00Z" },
  },
});
const mount = (clock: ReturnType<typeof createTestRyotClock>, Probe: ComponentType) =>
  mountPluginPage(Probe, {
    bootstrap: clock.bootstrap,
    location: routeLocation("/v/k/analytics"),
    page: {
      ...savedViewPageContext({
        settings: {},
        savedViewId: "analytics",
        rendererName: "analytics",
        dataSources: { queries: {} },
        view: { icon: "chart", name: "Analytics" },
      }),
      contributors: ["media-owner", "media-other"].map((pluginId) =>
        pluginContributor({ pluginId, name: "Media", packageId: PLUGIN_PACKAGE_ID }),
      ),
    },
  });
const chartRequests = (page: ReturnType<typeof mount>) =>
  page.queryRequests().filter(({ document }) => !Object.hasOwn(document.queries, "processing"));
const replyCharts = (page: ReturnType<typeof mount>, requests = chartRequests(page)) => {
  for (const request of requests) {
    const queries = request.document.queries;
    page.replyQuery(request.requestId, {
      outcome: "success",
      response: {
        data: Object.hasOwn(queries, "hourly")
          ? { hourly: aggregate([hourRow]) }
          : {
              current: aggregate([]),
              ...(Object.hasOwn(queries, "previous") ? { previous: aggregate([]) } : {}),
            },
      },
    });
  }
};

describe("Media analytics query adapters", () => {
  it.live(
    "keeps chart results through pending summary polls and reloads them once it settles",
    () =>
      Effect.gen(function* () {
        const clock = createTestRyotClock();
        const started = Date.parse("2026-11-01T18:00:00Z");
        yield* Effect.promise(() => clock.setTime(started));
        const page = mount(clock, CoupledProbe);
        try {
          yield* Effect.promise(() =>
            waitFor(() => expect(page.queryRequests("processing")).toHaveLength(1)),
          );
          for (const request of page.queryRequests("processing")) {
            page.replyQuery(request.requestId, { outcome: "success", response: reportResponse(1) });
          }
          yield* Effect.promise(() => waitFor(() => expect(chartRequests(page)).toHaveLength(3)));
          replyCharts(page);
          yield* Effect.promise(() =>
            waitFor(() =>
              expect(screen.getByLabelText("Chart clocks").textContent).toBe(
                [started, started, started].join(","),
              ),
            ),
          );
          yield* Effect.promise(() => clock.advance(1000));
          yield* Effect.promise(() =>
            waitFor(() => expect(page.queryRequests("processing")).toHaveLength(2)),
          );
          for (const request of page.queryRequests("processing").slice(1)) {
            page.replyQuery(request.requestId, { outcome: "success", response: reportResponse(1) });
          }
          yield* Effect.promise(() =>
            waitFor(() =>
              expect(screen.getByLabelText("Primary clock").textContent).toBe(
                String(started + 1000),
              ),
            ),
          );
          expect(chartRequests(page)).toHaveLength(3);
          yield* Effect.promise(() => clock.advance(1000));
          yield* Effect.promise(() =>
            waitFor(() => expect(page.queryRequests("processing")).toHaveLength(3)),
          );
          for (const request of page.queryRequests("processing").slice(2)) {
            page.replyQuery(request.requestId, { outcome: "success", response: reportResponse() });
          }
          yield* Effect.promise(() => waitFor(() => expect(chartRequests(page)).toHaveLength(6)));
          replyCharts(page, chartRequests(page).slice(3));
          yield* Effect.promise(() =>
            waitFor(() =>
              expect(screen.getByLabelText("Chart clocks").textContent).toBe(
                Array.from({ length: 3 }, () => started + 2000).join(","),
              ),
            ),
          );
          yield* Effect.promise(() => clock.advance(3000));
          expect(page.queryRequests("processing")).toHaveLength(3);
        } finally {
          page.dispose();
          yield* Effect.promise(() => clock.dispose());
        }
      }),
  );
  for (const sample of [
    {
      offset: -1,
      end: "2026-03-01T05:00:00.000Z",
      start: "2026-02-01T05:00:00.000Z",
      current: "2026-02-01 – 2026-02-28",
      previous: "2026-01-01 – 2026-01-31",
      previousStart: "2026-01-01T05:00:00.000Z",
    },
    {
      offset: 0,
      end: "2026-04-01T04:00:00.000Z",
      start: "2026-03-01T05:00:00.000Z",
      current: "2026-03-01 – 2026-03-31",
      previous: "2026-02-01 – 2026-02-28",
      previousStart: "2026-02-01T05:00:00.000Z",
    },
  ] as const) {
    it.live(
      `resolves actual unequal calendar comparison dates and DST boundaries for offset ${sample.offset}`,
      () =>
        Effect.gen(function* () {
          const clock = createTestRyotClock();
          const selected = {
            ...input,
            selection: {
              ...input.selection,
              range: { unit: "month", kind: "calendar", offset: sample.offset },
            },
          } as const;
          yield* Effect.promise(() => clock.setTime(Date.parse("2026-03-15T12:00:00Z")));
          const page = mount(clock, monthProbe(selected));
          try {
            yield* Effect.promise(() =>
              waitFor(() => expect(page.queryRequests()).toHaveLength(2)),
            );
            for (const request of page.queryRequests("processing")) {
              expect(yield* documentText(request.document.queries["currentTypes"])).toContain(
                sample.start,
              );
              expect(yield* documentText(request.document.queries["currentTypes"])).toContain(
                sample.end,
              );
              expect(yield* documentText(request.document.queries["previousTypes"])).toContain(
                sample.previousStart,
              );
              page.replyQuery(request.requestId, {
                outcome: "success",
                response: reportResponse(),
              });
            }
            replyCharts(page);
            yield* Effect.promise(() =>
              waitFor(() =>
                expect(screen.getByLabelText("Month current").textContent).toBe(sample.current),
              ),
            );
            expect(screen.getByLabelText("Month prior").textContent).toBe(sample.previous);
            yield* Effect.promise(() =>
              waitFor(() =>
                expect(screen.getByLabelText("Prior chart").textContent).toBe(sample.previous),
              ),
            );
          } finally {
            page.dispose();
            yield* Effect.promise(() => clock.dispose());
          }
        }),
    );
  }
  it.live(
    "executes one eight-query summary and labels it from the same captured clock across refresh",
    () =>
      Effect.gen(function* () {
        const clock = createTestRyotClock();
        yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
        const page = mount(clock, ReportProbe);
        try {
          yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(1)));
          for (const request of page.queryRequests()) {
            expect(Object.keys(request.document.queries)).toHaveLength(8);
            expect(yield* documentText(request.document)).toContain("2026-11-02T05:00:00.000Z");
            page.replyQuery(request.requestId, { outcome: "success", response: reportResponse() });
          }
          yield* Effect.promise(() =>
            waitFor(() =>
              expect(screen.getByLabelText("Period").textContent).toBe("2026-10-26 – 2026-11-01"),
            ),
          );
          expect(screen.getByLabelText("Previous").textContent).toBe("2026-10-19 – 2026-10-25");
          yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-02T18:00:00Z")));
          act(() => {
            fireEvent.click(screen.getByRole("button", { name: "Refresh report" }));
          });
          yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(2)));
          for (const request of page.queryRequests().slice(1)) {
            expect(yield* documentText(request.document)).toContain("2026-11-03T05:00:00.000Z");
            page.replyQuery(request.requestId, { outcome: "success", response: reportResponse() });
          }
          yield* Effect.promise(() =>
            waitFor(() =>
              expect(screen.getByLabelText("Period").textContent).toBe("2026-10-27 – 2026-11-02"),
            ),
          );
        } finally {
          page.dispose();
          yield* Effect.promise(() => clock.dispose());
        }
      }),
  );
  it.live("refreshes pending processing and stops after readiness", () =>
    Effect.gen(function* () {
      const clock = createTestRyotClock();
      const page = mount(clock, ReportProbe);
      try {
        yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(1)));
        for (const request of page.queryRequests()) {
          page.replyQuery(request.requestId, { outcome: "success", response: reportResponse(1) });
        }
        yield* Effect.promise(() =>
          waitFor(() => expect(screen.getByText("pending")).toBeDefined()),
        );
        yield* Effect.promise(() => clock.advance(1000));
        yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(2)));
        for (const request of page.queryRequests().slice(1)) {
          page.replyQuery(request.requestId, { outcome: "success", response: reportResponse() });
        }
        yield* Effect.promise(() => waitFor(() => expect(screen.getByText("ready")).toBeDefined()));
        yield* Effect.promise(() => clock.advance(3000));
        expect(page.queryRequests()).toHaveLength(2);
      } finally {
        page.dispose();
        yield* Effect.promise(() => clock.dispose());
      }
    }),
  );
  it.live("clips the daily heatmap to the most recent bucket-limit days of all time", () =>
    Effect.gen(function* () {
      const clock = createTestRyotClock();
      yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-02T18:00:00Z")));
      const page = mount(clock, ConsistencyProbe);
      try {
        yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(1)));
        for (const request of page.queryRequests()) {
          const text = yield* documentText(request.document);
          expect(text).toContain("2026-10-27T04:00:00.000Z");
          expect(text).toContain('"bucket":"day"');
          expect(Object.keys(request.document.queries)).toEqual(["current"]);
          page.replyQuery(request.requestId, {
            outcome: "success",
            response: { data: { current: aggregate([]) } },
          });
        }
        yield* Effect.promise(() =>
          waitFor(() => expect(screen.getByText("2026-10-27 – 2026-11-02")).toBeDefined()),
        );
        expect(screen.getByLabelText("Clipped").textContent).toBe("false");
      } finally {
        page.dispose();
        yield* Effect.promise(() => clock.dispose());
      }
    }),
  );
  for (const { key, Probe } of [
    { key: "ranking", Probe: RankingProbe },
    { key: "records", Probe: RecordsProbe },
  ] as const) {
    it.live(
      `pins ${key} continuations to the first page and refreshes the original selection to loaded depth only`,
      () =>
        Effect.gen(function* () {
          const clock = createTestRyotClock();
          yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
          const page = mount(clock, Probe);
          try {
            yield* Effect.promise(() =>
              waitFor(() => expect(page.queryRequests(key)).toHaveLength(1)),
            );
            for (const request of page.queryRequests(key)) {
              page.replyQuery(request.requestId, {
                outcome: "success",
                response: cursorResponse(key, "first-cursor"),
              });
            }
            yield* Effect.promise(() =>
              waitFor(() => expect(screen.getByText("1 pages")).toBeDefined()),
            );
            yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-02T18:00:00Z")));
            act(() => {
              fireEvent.click(screen.getByRole("button", { name: "More" }));
            });
            yield* Effect.promise(() =>
              waitFor(() => expect(page.queryRequests(key)).toHaveLength(2)),
            );
            for (const request of page.queryRequests(key).slice(1)) {
              const text = yield* documentText(request.document);
              expect(text).toContain("first-cursor");
              expect(text).toContain("2026-10-26T04:00:00.000Z");
              expect(text).toContain("2026-11-02T05:00:00.000Z");
              if (key === "records") {
                expect(text).toContain("original-title");
                expect(text).toContain("localHour");
              }
              page.replyQuery(request.requestId, {
                outcome: "success",
                response: cursorResponse(key, "second-cursor"),
              });
            }
            yield* Effect.promise(() =>
              waitFor(() => expect(screen.getByText("2 pages")).toBeDefined()),
            );
            expect(screen.getByLabelText("Page clock").textContent).toBe(
              String(Date.parse("2026-11-02T18:00:00Z")),
            );
            act(() => {
              fireEvent.click(screen.getByRole("button", { name: "Refresh pages" }));
            });
            yield* Effect.promise(() =>
              waitFor(() => expect(page.queryRequests(key)).toHaveLength(3)),
            );
            for (const request of page.queryRequests(key).slice(2)) {
              const text = yield* documentText(request.document);
              expect(text).not.toContain("first-cursor");
              expect(text).toContain("2026-10-27T04:00:00.000Z");
              expect(text).toContain("2026-11-03T05:00:00.000Z");
              page.replyQuery(request.requestId, {
                outcome: "success",
                response: cursorResponse(key, "refreshed-cursor"),
              });
            }
            yield* Effect.promise(() =>
              waitFor(() => expect(page.queryRequests(key)).toHaveLength(4)),
            );
            for (const request of page.queryRequests(key).slice(3)) {
              expect(yield* documentText(request.document)).toContain("refreshed-cursor");
              expect(yield* documentText(request.document)).toContain("2026-11-03T05:00:00.000Z");
              page.replyQuery(request.requestId, {
                outcome: "success",
                response: cursorResponse(key, "third-cursor"),
              });
            }
            yield* Effect.promise(() =>
              waitFor(() => expect(screen.getByText("2 pages")).toBeDefined()),
            );
            expect(page.queryRequests(key)).toHaveLength(4);
          } finally {
            page.dispose();
            yield* Effect.promise(() => clock.dispose());
          }
        }),
    );
  }
  it.live(
    "retains loaded source rows and depth when a captured-page refresh fails, then retries from the stable original selection",
    () =>
      Effect.gen(function* () {
        const clock = createTestRyotClock();
        yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-01T18:00:00Z")));
        const page = mount(clock, RecordsProbe);
        try {
          yield* Effect.promise(() =>
            waitFor(() => expect(page.queryRequests("records")).toHaveLength(1)),
          );
          for (const request of page.queryRequests("records")) {
            page.replyQuery(request.requestId, {
              outcome: "success",
              response: cursorResponse("records", "first", [sourceRecord("First")]),
            });
          }
          yield* Effect.promise(() =>
            waitFor(() => expect(screen.getByLabelText("Source rows").textContent).toBe("First")),
          );
          act(() => {
            fireEvent.click(screen.getByRole("button", { name: "More" }));
          });
          yield* Effect.promise(() =>
            waitFor(() => expect(page.queryRequests("records")).toHaveLength(2)),
          );
          for (const request of page.queryRequests("records").slice(1)) {
            page.replyQuery(request.requestId, {
              outcome: "success",
              response: cursorResponse("records", "second", [sourceRecord("Second")]),
            });
          }
          yield* Effect.promise(() =>
            waitFor(() =>
              expect(screen.getByLabelText("Source rows").textContent).toBe("First,Second"),
            ),
          );
          yield* Effect.promise(() => clock.setTime(Date.parse("2026-11-02T18:00:00Z")));
          act(() => {
            fireEvent.click(screen.getByRole("button", { name: "Refresh pages" }));
          });
          yield* Effect.promise(() =>
            waitFor(() => expect(page.queryRequests("records")).toHaveLength(3)),
          );
          for (const request of page.queryRequests("records").slice(2)) {
            expect(yield* documentText(request.document)).toContain("2026-10-27T04:00:00.000Z");
            page.replyQuery(request.requestId, {
              outcome: "success",
              response: cursorResponse("records", "replacement", [sourceRecord("Replacement")]),
            });
          }
          yield* Effect.promise(() =>
            waitFor(() => expect(page.queryRequests("records")).toHaveLength(4)),
          );
          expect(screen.getByLabelText("Source rows").textContent).toBe("First,Second");
          for (const request of page.queryRequests("records").slice(3)) {
            page.replyQuery(request.requestId, { outcome: "failure", reason: "query-failed" });
          }
          yield* Effect.promise(() =>
            waitFor(() => expect(screen.getByText("refresh")).toBeDefined()),
          );
          expect(screen.getByText("2 pages")).toBeDefined();
          expect(screen.getByLabelText("Source rows").textContent).toBe("First,Second");
          act(() => {
            fireEvent.click(screen.getByRole("button", { name: "Retry" }));
          });
          yield* Effect.promise(() =>
            waitFor(() => expect(page.queryRequests("records")).toHaveLength(5)),
          );
          for (const request of page.queryRequests("records").slice(4)) {
            expect(yield* documentText(request.document)).not.toContain("replacement");
            expect(yield* documentText(request.document)).toContain("2026-11-03T05:00:00.000Z");
            page.replyQuery(request.requestId, {
              outcome: "success",
              response: cursorResponse("records", "retry-first", [sourceRecord("New first")]),
            });
          }
          yield* Effect.promise(() =>
            waitFor(() => expect(page.queryRequests("records")).toHaveLength(6)),
          );
          for (const request of page.queryRequests("records").slice(5)) {
            expect(yield* documentText(request.document)).toContain("retry-first");
            expect(yield* documentText(request.document)).toContain("2026-11-03T05:00:00.000Z");
            page.replyQuery(request.requestId, {
              outcome: "success",
              response: cursorResponse("records", "retry-second", [sourceRecord("New second")]),
            });
          }
          yield* Effect.promise(() =>
            waitFor(() =>
              expect(screen.getByLabelText("Source rows").textContent).toBe("New first,New second"),
            ),
          );
          expect(screen.getByText("2 pages")).toBeDefined();
          expect(page.queryRequests("records")).toHaveLength(6);
        } finally {
          page.dispose();
          yield* Effect.promise(() => clock.dispose());
        }
      }),
  );
  it.live("keeps append cursor errors visible and owner changes separate", () =>
    Effect.gen(function* () {
      const clock = createTestRyotClock();
      const page = mount(clock, RecordsProbe);
      try {
        yield* Effect.promise(() =>
          waitFor(() => expect(page.queryRequests("records")).toHaveLength(1)),
        );
        for (const request of page.queryRequests("records")) {
          page.replyQuery(request.requestId, {
            outcome: "success",
            response: cursorResponse("records", "first"),
          });
        }
        yield* Effect.promise(() =>
          waitFor(() => expect(screen.getByText("1 pages")).toBeDefined()),
        );
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: "More" }));
        });
        yield* Effect.promise(() =>
          waitFor(() => expect(page.queryRequests("records")).toHaveLength(2)),
        );
        for (const request of page.queryRequests("records").slice(1)) {
          page.replyQuery(request.requestId, {
            outcome: "success",
            response: cursorResponse("records", "first"),
          });
        }
        yield* Effect.promise(() =>
          waitFor(() => expect(screen.getByText("append")).toBeDefined()),
        );
        expect(screen.getByText("1 pages")).toBeDefined();
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: "Other owner" }));
        });
        yield* Effect.promise(() =>
          waitFor(() => expect(page.queryRequests("records")).toHaveLength(3)),
        );
        expect(screen.getByText("0 pages")).toBeDefined();
        for (const request of page.queryRequests("records").slice(2)) {
          expect(yield* documentText(request.document)).toContain("media-other");
          expect(yield* documentText(request.document)).not.toContain("media-owner");
        }
      } finally {
        page.dispose();
        yield* Effect.promise(() => clock.dispose());
      }
    }),
  );
  it.live("reloads source pages when global consumption processing becomes ready", () =>
    Effect.gen(function* () {
      const clock = createTestRyotClock();
      const page = mount(clock, RecordsProbe);
      try {
        yield* Effect.promise(() =>
          waitFor(() => expect(page.queryRequests("records")).toHaveLength(1)),
        );
        for (const request of page.queryRequests("records")) {
          page.replyQuery(request.requestId, {
            outcome: "success",
            response: cursorResponse("records", "partial-cursor"),
          });
        }
        yield* Effect.promise(() =>
          waitFor(() => expect(screen.getByText("1 pages")).toBeDefined()),
        );
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: "Processing ready" }));
        });
        yield* Effect.promise(() =>
          waitFor(() => expect(page.queryRequests("records")).toHaveLength(2)),
        );
        expect(screen.getByText("0 pages")).toBeDefined();
        for (const request of page.queryRequests("records").slice(1)) {
          expect(yield* documentText(request.document)).not.toContain("partial-cursor");
          page.replyQuery(request.requestId, {
            outcome: "success",
            response: cursorResponse("records", null),
          });
        }
        yield* Effect.promise(() =>
          waitFor(() => expect(screen.getByText("1 pages")).toBeDefined()),
        );
      } finally {
        page.dispose();
        yield* Effect.promise(() => clock.dispose());
      }
    }),
  );
  it.live("cancels the summary request when the section unmounts", () =>
    Effect.gen(function* () {
      const clock = createTestRyotClock();
      const page = mount(clock, UnmountProbe);
      try {
        yield* Effect.promise(() => waitFor(() => expect(page.queryRequests()).toHaveLength(1)));
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: "Hide" }));
        });
        yield* Effect.promise(() =>
          waitFor(() =>
            expect(
              page.clientMessages().filter((message) => message.type === "ryotql-cancel"),
            ).toHaveLength(1),
          ),
        );
      } finally {
        page.dispose();
        yield* Effect.promise(() => clock.dispose());
      }
    }),
  );
});
