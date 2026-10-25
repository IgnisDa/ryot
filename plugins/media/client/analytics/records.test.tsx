import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import {
  createTestRyotClock,
  disposePluginBridges,
  mountPluginPage,
  pluginContributor,
  routeLocation,
  savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { act, type ComponentType, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { analyticsSummary } from "../../tests/client/analytics-fixture";
import type {
  AnalyticsInput,
  MediaAnalyticsProcessing,
  MediaAnalyticsRecord,
  RecordsDrillRequest,
} from "./model";
import { MediaAnalyticsRecords } from "./records";

afterEach(disposePluginBridges);

const input: AnalyticsInput = {
  timeZone: TimeZone.make("America/New_York"),
  reference: { kind: "local", pluginId: PluginId.make("media-owner") },
  selection: {
    grouping: "day",
    comparison: "previous-period",
    range: { days: 30, kind: "rolling" },
  },
};
const selectedPeriod = {
  grouping: "day",
  comparison: "none",
  range: { kind: "custom", endDate: "2026-09-07", startDate: "2026-09-01" },
} as const;
const request: RecordsDrillRequest = {
  hour: 1,
  activeOnly: true,
  mediaType: "book",
  title: "Captured title",
  selection: selectedPeriod,
  entityId: "title/record-source",
  periodCaption: "2026-09-01 – 2026-09-07",
};
const summaryFor = (processing: MediaAnalyticsProcessing = "ready") =>
  analyticsSummary(input, { processing, now: Date.parse("2026-10-29T12:00:00Z") });
const contribution = (
  attribution: MediaAnalyticsRecord["contribution"]["attribution"] = {
    kind: "instant",
    value: "2026-09-04T14:00:00Z",
  },
): MediaAnalyticsRecord["contribution"] => ({
  attribution,
  titleCompletions: 1,
  episodeCompletions: 0,
  activeObservation: true,
});
const recordRow = (
  id: string,
  name: string,
  options: {
    readonly entityId?: string;
    readonly mediaType?: string;
    readonly eventType?: string;
    readonly occurredAt?: string;
    readonly facts?: MediaAnalyticsRecord["facts"];
    readonly contribution?: MediaAnalyticsRecord["contribution"];
  } = {},
): MediaAnalyticsRecord => ({
  id,
  name,
  orderKey: id,
  facts: options.facts ?? {},
  mediaType: options.mediaType ?? "book",
  eventType: options.eventType ?? "progress",
  entityId: options.entityId ?? "title/record-source",
  contribution: options.contribution ?? contribution(),
  occurredAt: options.occurredAt ?? "2026-09-04T14:00:00Z",
  orderCreatedAt: options.occurredAt ?? "2026-09-04T14:00:00Z",
  label: options.mediaType === "show-episode" ? "Show episode" : "Book",
});
const recordsResponse = (
  nextCursor: null | string,
  items: readonly MediaAnalyticsRecord[] = [],
) => ({
  data: {
    records: {
      items,
      type: "rows" as const,
      pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
    },
  },
});
const documentText = (value: unknown) => JSON.stringify(value);
const mountPage = (clock: ReturnType<typeof createTestRyotClock>, Component: ComponentType) =>
  mountPluginPage(Component, {
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
      contributors: ["media-owner", "media-next"].map((pluginId) =>
        pluginContributor({ pluginId, name: "Media", packageId: PLUGIN_PACKAGE_ID }),
      ),
    },
  });
const mountRecords = (
  clock: ReturnType<typeof createTestRyotClock>,
  selectedRequest = request,
  selectedSummary = summaryFor(),
) =>
  mountPage(clock, () => (
    <MediaAnalyticsRecords
      input={input}
      onClose={() => {}}
      summary={selectedSummary}
      request={selectedRequest}
    />
  ));
const itemAt = <Item,>(items: readonly Item[], index: number): Item => {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Expected an item at ${index}`);
  }
  return item;
};
const recordsRequests = (page: ReturnType<typeof mountPage>) => page.queryRequests("records");
function DrillProbe() {
  const [open, setOpen] = useState(false);
  const [drillRequest, setDrillRequest] = useState(request);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open records
      </button>
      <button
        type="button"
        onClick={() =>
          setDrillRequest({
            activeOnly: false,
            mediaType: "show-episode",
            title: "All show records",
            selection: request.selection,
            periodCaption: request.periodCaption,
          })
        }
      >
        Change drill filters
      </button>
      {open ? (
        <MediaAnalyticsRecords
          input={input}
          summary={summaryFor()}
          request={drillRequest}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

describe("Media analytics records drill", () => {
  it.live(
    "pins the requested entity, filters, period, timezone and cursor while retaining source order across pages",
    () =>
      Effect.gen(function* () {
        const clock = createTestRyotClock();
        const page = mountRecords(clock);
        try {
          yield* Effect.promise(() => waitFor(() => expect(recordsRequests(page)).toHaveLength(1)));
          const firstRequest = itemAt(recordsRequests(page), 0);
          const firstQuery = documentText(firstRequest.document);
          expect(firstQuery).toContain("title/record-source");
          expect(firstQuery).toContain("America/New_York");
          expect(firstQuery).toContain("localHour");
          expect(firstQuery).toContain("2026-09-01");
          expect(firstQuery).toContain("2026-09-07");
          const tieNames = new Map([
            [0, "Zulu tied event"],
            [1, "Alpha tied event"],
          ]);
          const firstRows = Array.from({ length: 100 }, (_, index) =>
            recordRow(
              `record-${String(index + 1).padStart(3, "0")}`,
              tieNames.get(index) ?? `Record ${index + 1}`,
              {
                occurredAt: "2026-09-04T14:00:00Z",
                contribution: contribution({ kind: "date", value: "2026-09-04" }),
              },
            ),
          );
          page.replyQuery(firstRequest.requestId, {
            outcome: "success",
            response: recordsResponse("opaque-records/next?cursor=kept", firstRows),
          });
          yield* Effect.promise(() =>
            waitFor(() => expect(screen.getByText("100+ records loaded")).toBeDefined()),
          );
          expect(
            screen.getByText(
              "Period: 2026-09-01 – 2026-09-07 · Time zone: America/New_York · Type: book · Hour: 1 · Active observations only",
            ),
          ).toBeDefined();
          const table = screen.getByRole("table", { name: "Media analytics records" });
          const initialOrder = within(table)
            .getAllByRole("row")
            .slice(1, 3)
            .map((row) => row.querySelector("td")?.textContent);
          expect(initialOrder).toEqual(["Zulu tied event", "Alpha tied event"]);
          const firstRecord = within(table).getByRole("row", { name: /Zulu tied event/ });
          expect(within(firstRecord).getByText("2026-09-04")).toBeDefined();
          act(() => {
            fireEvent.click(screen.getByRole("button", { name: "Show more records" }));
          });
          yield* Effect.promise(() => waitFor(() => expect(recordsRequests(page)).toHaveLength(2)));
          const nextRequest = itemAt(recordsRequests(page), 1);
          expect(documentText(nextRequest.document)).toContain("opaque-records/next?cursor=kept");
          page.replyQuery(nextRequest.requestId, {
            outcome: "success",
            response: recordsResponse(null, [recordRow("record-101", "Record 101")]),
          });
          yield* Effect.promise(() =>
            waitFor(() => expect(screen.getByText("101 records loaded")).toBeDefined()),
          );
          expect(within(table).getAllByRole("row")).toHaveLength(102);
          expect(within(table).getByText("Record 101")).toBeDefined();
          expect(page.queryRequests("records")).toHaveLength(2);
        } finally {
          page.dispose();
          yield* Effect.promise(() => clock.dispose());
        }
      }),
  );

  it.live(
    "renders raw source facts and exact per-unit contributions without merging item, title, or episode meanings",
    () =>
      Effect.gen(function* () {
        const clock = createTestRyotClock();
        const page = mountRecords(clock);
        try {
          yield* Effect.promise(() => waitFor(() => expect(recordsRequests(page)).toHaveLength(1)));
          page.replyQuery(itemAt(recordsRequests(page), 0).requestId, {
            outcome: "success",
            response: recordsResponse(null, [
              recordRow("item-event", "Independent episode item", {
                mediaType: "show-episode",
                eventType: "item-complete",
                contribution: {
                  ...contribution({ kind: "date", value: "2026-09-04" }),
                  titleCompletions: 0,
                  episodeCompletions: 1,
                  minutes: { recorded: 0, estimated: 0, missing: false, supersededEstimate: false },
                  pages: {
                    missing: true,
                    recorded: 0.25,
                    estimated: 1.75,
                    supersededEstimate: false,
                  },
                },
                facts: {
                  timeSpent: 0,
                  progressPages: 0,
                  progressPercent: 42.5,
                  calendarDate: "2026-09-04",
                  completionKey: "source/independent-item",
                  consumedItem: { position: 12, unit: "episodes" },
                  sourceProgress: { position: 12, percent: 42.5, unit: "episodes" },
                  consumptionBasis: { total: 24, unit: "episodes", property: "episodes" },
                },
              }),
              recordRow("unknown-event", "Unknown date source", {
                eventType: "progress",
                occurredAt: "2026-09-04T14:00:00Z",
                contribution: contribution({ kind: "unknown" }),
              }),
              recordRow("instant-event", "Instant date source", {
                occurredAt: "2026-09-04T02:30:00Z",
                contribution: contribution({ kind: "instant", value: "2026-09-04T02:30:00Z" }),
              }),
            ]),
          });
          yield* Effect.promise(() =>
            waitFor(() => expect(screen.getByText("Independent episode item")).toBeDefined()),
          );
          const table = screen.getByRole("table", { name: "Media analytics records" });
          const itemRow = within(table).getByRole("row", { name: /Independent episode item/ });
          expect(within(itemRow).getByText("Show episode")).toBeDefined();
          expect(within(itemRow).getByText("item-complete")).toBeDefined();
          expect(within(itemRow).getByText("Consumed item position:")).toBeDefined();
          expect(within(itemRow).getByText("episodes position 12")).toBeDefined();
          expect(within(itemRow).getByText("Manually recorded time:")).toBeDefined();
          expect(within(itemRow).getByText("0 minutes")).toBeDefined();
          expect(within(itemRow).getByText("Source progress:")).toBeDefined();
          expect(within(itemRow).getByText(/not an allocated amount/)).toBeDefined();
          expect(within(itemRow).getByText("Source progress pages:")).toBeDefined();
          expect(within(itemRow).getByText("0 pages")).toBeDefined();
          expect(within(itemRow).getByText("Source progress percent:")).toBeDefined();
          expect(within(itemRow).getByText("42.5 %")).toBeDefined();
          expect(within(itemRow).getByText("Frozen consumption basis:")).toBeDefined();
          expect(
            within(itemRow).getByText("episodes · total 24 · source property episodes"),
          ).toBeDefined();
          expect(within(itemRow).getByText("Title completions:")).toBeDefined();
          expect(within(itemRow).getByText("Episode completions:")).toBeDefined();
          expect(
            within(itemRow).getByText(
              "0.25 recorded · 1.75 estimated · missing: yes · superseded estimate: no",
            ),
          ).toBeDefined();
          expect(
            within(itemRow).getByText(
              "0 recorded · 0 estimated · missing: no · superseded estimate: no",
            ),
          ).toBeDefined();
          const dateRow = within(table).getByRole("row", { name: /Unknown date source/ });
          expect(within(dateRow).getByText("Unknown date")).toBeDefined();
          expect(within(dateRow).queryByText("Sep 4, 2026, 10:00 AM")).toBeNull();
          const instantRow = within(table).getByRole("row", { name: /Instant date source/ });
          expect(within(instantRow).getByText(/Sep 3, 2026/)).toBeDefined();
          expect(within(instantRow).getByText(/10:30 PM/)).toBeDefined();
        } finally {
          page.dispose();
          yield* Effect.promise(() => clock.dispose());
        }
      }),
  );

  it.live(
    "keeps source facts and canonical contributions visible while processing is pending",
    () =>
      Effect.gen(function* () {
        const clock = createTestRyotClock();
        const page = mountRecords(clock, request, summaryFor("pending"));
        try {
          yield* Effect.promise(() => waitFor(() => expect(recordsRequests(page)).toHaveLength(1)));
          page.replyQuery(itemAt(recordsRequests(page), 0).requestId, {
            outcome: "success",
            response: recordsResponse(null, [
              recordRow("pending-item", "Pending source title", {
                eventType: "item-complete",
                facts: { timeSpent: 0, consumedItem: { position: 3, unit: "chapters" } },
              }),
            ]),
          });
          yield* Effect.promise(() =>
            waitFor(() => expect(screen.getByText("Pending source title")).toBeDefined()),
          );
          const row = within(
            screen.getByRole("table", { name: "Media analytics records" }),
          ).getByRole("row", { name: /Pending source title/ });
          expect(within(row).getByText("item-complete")).toBeDefined();
          expect(within(row).getByText("chapters position 3")).toBeDefined();
          expect(within(row).getByText("0 minutes")).toBeDefined();
          expect(within(row).getByText("Active observation:")).toBeDefined();
        } finally {
          page.dispose();
          yield* Effect.promise(() => clock.dispose());
        }
      }),
  );

  it.live(
    "retains loaded rows on append and refresh failures and retries to the same loaded depth",
    () =>
      Effect.gen(function* () {
        const clock = createTestRyotClock();
        const page = mountRecords(clock);
        try {
          yield* Effect.promise(() => waitFor(() => expect(recordsRequests(page)).toHaveLength(1)));
          page.replyQuery(itemAt(recordsRequests(page), 0).requestId, {
            outcome: "success",
            response: recordsResponse("append-one", [
              recordRow("old-one", "Original first record"),
            ]),
          });
          yield* Effect.promise(() =>
            waitFor(() => expect(screen.getByText("Original first record")).toBeDefined()),
          );
          act(() => {
            fireEvent.click(screen.getByRole("button", { name: "Show more records" }));
          });
          yield* Effect.promise(() => waitFor(() => expect(recordsRequests(page)).toHaveLength(2)));
          const append = itemAt(recordsRequests(page), 1);
          page.replyQuery(append.requestId, { outcome: "failure", reason: "query-failed" });
          yield* Effect.promise(() =>
            waitFor(() =>
              expect(screen.getByText("More records couldn't be loaded.")).toBeDefined(),
            ),
          );
          expect(screen.getByText("Original first record")).toBeDefined();
          act(() => {
            fireEvent.click(screen.getByRole("button", { name: "Try again" }));
          });
          yield* Effect.promise(() => waitFor(() => expect(recordsRequests(page)).toHaveLength(3)));
          expect(documentText(itemAt(recordsRequests(page), 2).document)).toContain("append-one");
          page.replyQuery(itemAt(recordsRequests(page), 2).requestId, {
            outcome: "success",
            response: recordsResponse(null, [recordRow("old-two", "Original second record")]),
          });
          yield* Effect.promise(() =>
            waitFor(() => expect(screen.getByText("Original second record")).toBeDefined()),
          );
          act(() => {
            fireEvent.click(screen.getByRole("button", { name: "Refresh records" }));
          });
          yield* Effect.promise(() => waitFor(() => expect(recordsRequests(page)).toHaveLength(4)));
          page.replyQuery(itemAt(recordsRequests(page), 3).requestId, {
            outcome: "failure",
            reason: "query-failed",
          });
          yield* Effect.promise(() =>
            waitFor(() =>
              expect(screen.getByText("The records couldn't be refreshed.")).toBeDefined(),
            ),
          );
          expect(screen.getByText("2 records loaded")).toBeDefined();
          expect(screen.getByText("Original first record")).toBeDefined();
          expect(screen.getByText("Original second record")).toBeDefined();
          act(() => {
            fireEvent.click(screen.getByRole("button", { name: "Try again" }));
          });
          yield* Effect.promise(() => waitFor(() => expect(recordsRequests(page)).toHaveLength(5)));
          page.replyQuery(itemAt(recordsRequests(page), 4).requestId, {
            outcome: "success",
            response: recordsResponse("new-next", [
              recordRow("new-one", "Replacement first record"),
            ]),
          });
          yield* Effect.promise(() => waitFor(() => expect(recordsRequests(page)).toHaveLength(6)));
          expect(documentText(itemAt(recordsRequests(page), 5).document)).toContain("new-next");
          page.replyQuery(itemAt(recordsRequests(page), 5).requestId, {
            outcome: "success",
            response: recordsResponse(null, [recordRow("new-two", "Replacement second record")]),
          });
          yield* Effect.promise(() =>
            waitFor(() => expect(screen.getByText("Replacement second record")).toBeDefined()),
          );
          expect(screen.queryByText("Original first record")).toBeNull();
          expect(screen.queryByText("Original second record")).toBeNull();
          expect(screen.getByText("2 records loaded")).toBeDefined();
        } finally {
          page.dispose();
          yield* Effect.promise(() => clock.dispose());
        }
      }),
  );

  it.live(
    "drops late pages after the captured drill filter changes and restores focus after dialog dismissal",
    () =>
      Effect.gen(function* () {
        const clock = createTestRyotClock();
        const page = mountPage(clock, DrillProbe);
        try {
          const trigger = yield* Effect.promise(() =>
            waitFor(() => screen.getByRole("button", { name: "Open records" })),
          );
          trigger.focus();
          act(() => {
            fireEvent.click(trigger);
          });
          yield* Effect.promise(() => waitFor(() => expect(recordsRequests(page)).toHaveLength(1)));
          const originalRequest = itemAt(recordsRequests(page), 0);
          act(() => {
            fireEvent.click(screen.getByRole("button", { name: "Change drill filters" }));
          });
          yield* Effect.promise(() => waitFor(() => expect(recordsRequests(page)).toHaveLength(2)));
          const changedRequest = itemAt(recordsRequests(page), 1);
          const changedText = documentText(changedRequest.document);
          expect(changedText).toContain("show-episode");
          expect(changedText).not.toContain("localHour");
          expect(changedText).not.toContain("title/record-source");
          expect(screen.queryByText("Loading records…")).toBeDefined();
          page.replyQuery(originalRequest.requestId, {
            outcome: "success",
            response: recordsResponse(null, [recordRow("stale", "Late filtered record")]),
          });
          page.replyQuery(changedRequest.requestId, {
            outcome: "success",
            response: recordsResponse(null, [recordRow("current", "Current filtered record")]),
          });
          yield* Effect.promise(() =>
            waitFor(() => expect(screen.getByText("Current filtered record")).toBeDefined()),
          );
          expect(screen.queryByText("Late filtered record")).toBeNull();
          act(() => {
            fireEvent.click(
              within(screen.getByRole("dialog")).getByRole("button", {
                name: "Close media analytics records",
              }),
            );
          });
          yield* Effect.promise(() =>
            waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()),
          );
          yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));
        } finally {
          page.dispose();
          yield* Effect.promise(() => clock.dispose());
        }
      }),
  );
});
