import {
  formatExactValue,
  PluginLink,
  type Reported,
  type TimeZone,
  useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import { paginationItems, useReportedPages } from "@ryot-app/plugin-client-sdk/react";
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  LoadMoreButton,
  MotionPresence,
  StatusMessage,
} from "@ryot-app/plugin-ui-sdk";
import { formatReportingDateTime } from "@ryot-app/plugin-ui-sdk/charts";
import { DataTable, type DataTableColumn } from "@ryot-app/plugin-ui-sdk/table";
import { useMemo } from "react";

import {
  type AnalyticsInput,
  type MediaAnalyticsRecord,
  type MediaAnalyticsSummary,
  recordModel,
  type RecordsDrillRequest,
} from "./model";
import { mediaAnalyticsRecordsQuery } from "./queries";

type RecordRow = ReturnType<typeof recordModel>;
type RecordTableProps = {
  readonly timeZone: TimeZone;
  readonly items: readonly MediaAnalyticsRecord[];
};

export function MediaAnalyticsRecords(props: {
  readonly onClose: () => void;
  readonly input: AnalyticsInput;
  readonly request: RecordsDrillRequest;
  readonly summary: Reported<MediaAnalyticsSummary>;
}) {
  const viewport = useRyotViewport();
  const result = useReportedPages(mediaAnalyticsRecordsQuery, {
    timeZone: props.input.timeZone,
    reference: props.input.reference,
    selection: props.request.selection,
    processing: props.summary.processing,
    ...(props.request.entityId === undefined ? {} : { entityId: props.request.entityId }),
    ...(props.request.mediaType === undefined ? {} : { mediaType: props.request.mediaType }),
    ...(props.request.hour === undefined ? {} : { hour: props.request.hour }),
    ...(props.request.activeOnly === undefined ? {} : { activeOnly: props.request.activeOnly }),
  });
  const items = useMemo(
    () =>
      paginationItems(
        result.pages,
        (page) => page.items,
        ({ id }) => id,
      ),
    [result.pages],
  );
  const loadedCaption =
    result.pages.length === 0
      ? null
      : `${items.length}${result.hasNextPage ? "+" : ""} ${items.length === 1 ? "record" : "records"}`;
  let errorMessage = "The records couldn't be loaded.";
  if (result.errorOperation === "append") {
    errorMessage = "More records couldn't be loaded.";
  } else if (result.errorOperation === "refresh") {
    errorMessage = "The records couldn't be refreshed.";
  }
  const heading = `${props.request.title} · ${props.request.periodCaption}`;
  const filters = [
    ...(props.request.mediaType === undefined ? [] : [`Type: ${props.request.mediaType}`]),
    ...(props.request.hour === undefined ? [] : [`Hour: ${props.request.hour}`]),
    ...(props.request.activeOnly === true ? ["Active observations only"] : []),
  ];
  return (
    <MotionPresence>
      <Dialog
        size="lg"
        title={heading}
        onClose={props.onClose}
        key="media-analytics-records"
        safeAreaBottom={viewport.safeAreaBottom}
        closeLabel="Close media analytics records"
        placement={viewport.compact ? "sheet" : "center"}
        footer={
          <Button variant="secondary" onClick={props.onClose}>
            Close
          </Button>
        }
      >
        <section
          className="flex min-w-0 flex-col gap-3"
          aria-label={`Records for ${props.request.title}`}
        >
          <p className="text-label text-text-muted">
            Period: {props.request.periodCaption} · Time zone: {props.input.timeZone}
            {filters.length === 0 ? "" : ` · ${filters.join(" · ")}`}
          </p>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
            {loadedCaption === null ? null : (
              <span className="text-label text-text-muted tabular-nums">
                {loadedCaption} loaded
              </span>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={result.refetch}
              disabled={result.isFetching}
            >
              Refresh records
            </Button>
          </div>
          {result.pages.length === 0 && result.isError ? (
            <StatusMessage
              tone="error"
              action={{ label: "Try again", onClick: result.retry, disabled: result.isFetching }}
            >
              {errorMessage}
            </StatusMessage>
          ) : null}
          {result.pages.length === 0 && !result.isError ? (
            <StatusMessage tone="pending">Loading records…</StatusMessage>
          ) : null}
          {result.pages.length > 0 ? (
            <>
              {result.operation === "refresh" ? (
                <StatusMessage tone="pending">Refreshing records…</StatusMessage>
              ) : null}
              {result.isError ? (
                <StatusMessage
                  tone="error"
                  action={{
                    label: "Try again",
                    onClick: result.retry,
                    disabled: result.isFetching,
                  }}
                >
                  {errorMessage}
                </StatusMessage>
              ) : null}
              {items.length === 0 ? (
                <EmptyState title="No records in this period" />
              ) : (
                <RecordTable items={items} timeZone={props.input.timeZone} />
              )}
              {result.hasNextPage && !result.isError ? (
                <LoadMoreButton
                  variant="secondary"
                  className="self-center"
                  label="Show more records"
                  disabled={result.isFetching}
                  onClick={result.fetchNextPage}
                  isFetchingNextPage={result.isFetchingNextPage}
                />
              ) : null}
            </>
          ) : null}
        </section>
      </Dialog>
    </MotionPresence>
  );
}

function RecordDate(props: { readonly timeZone: TimeZone; readonly row: MediaAnalyticsRecord }) {
  const attribution = props.row.contribution.attribution;
  const modeled = recordModel(props.row);
  if (attribution.kind === "unknown") {
    return <span>{modeled.date}</span>;
  }
  if (attribution.kind === "date") {
    return <time dateTime={attribution.value}>{modeled.date}</time>;
  }
  return (
    <time dateTime={attribution.value}>
      {formatReportingDateTime(attribution.value, props.timeZone)}
    </time>
  );
}
function Contribution(props: { readonly contribution: MediaAnalyticsRecord["contribution"] }) {
  const contribution = props.contribution;
  const measures = [
    ["Pages", contribution.pages],
    ["Minutes", contribution.minutes],
    ["Volumes", contribution.volumes],
    ["Episodes", contribution.episodes],
    ["Chapters", contribution.chapters],
  ] as const;
  return (
    <dl className="flex flex-col gap-1">
      <div>
        <dt className="inline font-medium text-text">Active observation: </dt>
        <dd className="inline">{contribution.activeObservation ? "Yes" : "No"}</dd>
      </div>
      <div>
        <dt className="inline font-medium text-text">Title completions: </dt>
        <dd className="inline">{formatExactValue(contribution.titleCompletions)}</dd>
      </div>
      <div>
        <dt className="inline font-medium text-text">Episode completions: </dt>
        <dd className="inline">{formatExactValue(contribution.episodeCompletions)}</dd>
      </div>
      {measures.map(([label, measure]) =>
        measure === undefined ? null : (
          <div key={label}>
            <dt className="inline font-medium text-text">{label}: </dt>
            <dd className="inline">
              {formatExactValue(measure.recorded, "recorded")} ·{" "}
              {formatExactValue(measure.estimated, "estimated")} · missing:{" "}
              {measure.missing ? "yes" : "no"} · superseded estimate:{" "}
              {measure.supersededEstimate ? "yes" : "no"}
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

const headerClassName = "px-3 py-2.5 text-left font-medium text-text-muted";

const recordColumns = ({ timeZone }: RecordTableProps): DataTableColumn<RecordRow>[] => [
  {
    id: "name",
    header: "Name",
    headerClassName,
    cellClassName: "px-3 py-2.5",
    cell: ({ source: row }) => (
      <PluginLink
        className="font-medium text-accent-text"
        to={{ kind: "entity", entityId: row.entityId }}
      >
        {row.name}
      </PluginLink>
    ),
  },
  {
    id: "category",
    headerClassName,
    header: "Category",
    cell: ({ source: row }) => row.label,
    cellClassName: "px-3 py-2.5 text-text-muted",
  },
  {
    headerClassName,
    id: "event-type",
    header: "Source event type",
    cell: ({ source: row }) => row.eventType,
    cellClassName: "px-3 py-2.5 text-text-muted",
  },
  {
    id: "date",
    headerClassName,
    header: "Reading date",
    cellClassName: "whitespace-nowrap px-3 py-2.5 text-text-muted",
    cell: ({ source: row }) => <RecordDate row={row} timeZone={timeZone} />,
  },
  {
    id: "facts",
    headerClassName,
    header: "Source facts",
    cellClassName: "min-w-55 px-3 py-2.5 text-text-muted",
    cell: (modeled) => <SourceFacts modeled={modeled} row={modeled.source} />,
  },
  {
    headerClassName,
    id: "contribution",
    header: "Canonical contribution",
    cellClassName: "min-w-64 px-3 py-2.5 text-text-muted",
    cell: ({ source }) => <Contribution contribution={source.contribution} />,
  },
];

function RecordTable(props: RecordTableProps) {
  return (
    <Card padding="none" className="overflow-x-auto">
      <DataTable
        columns={recordColumns(props)}
        data={props.items.map(recordModel)}
        getRowId={({ source }) => source.id}
        aria-label="Media analytics records"
        rowClassName="border-t border-border align-top"
        className="w-full min-w-240 border-collapse text-sm tabular-nums"
      />
    </Card>
  );
}

function SourceFacts(props: {
  readonly row: MediaAnalyticsRecord;
  readonly modeled: ReturnType<typeof recordModel>;
}) {
  const { facts } = props.row;
  const lines = [
    ...(props.modeled.item === null
      ? []
      : [{ value: props.modeled.item, label: "Consumed item position" }]),
    ...(props.modeled.manualMinutes === null
      ? []
      : [
          {
            label: "Manually recorded time",
            value: formatExactValue(props.modeled.manualMinutes, "minutes"),
          },
        ]),
    ...(props.modeled.sourceProgress === null
      ? []
      : [{ label: "Source progress", value: props.modeled.sourceProgress }]),
    ...(facts.progressPages === undefined
      ? []
      : [
          { label: "Source progress pages", value: formatExactValue(facts.progressPages, "pages") },
        ]),
    ...(facts.progressPercent === undefined
      ? []
      : [
          { label: "Source progress percent", value: formatExactValue(facts.progressPercent, "%") },
        ]),
    ...(facts.consumptionBasis === undefined
      ? []
      : [
          {
            label: "Frozen consumption basis",
            value: [
              facts.consumptionBasis.unit,
              ...(facts.consumptionBasis.total === undefined
                ? []
                : [`total ${formatExactValue(facts.consumptionBasis.total)}`]),
              ...(facts.consumptionBasis.property === undefined
                ? []
                : [`source property ${facts.consumptionBasis.property}`]),
            ].join(" · "),
          },
        ]),
    ...(facts.calendarDate === undefined
      ? []
      : [{ value: facts.calendarDate, label: "Source calendar date" }]),
    ...(facts.consumedOn === undefined
      ? []
      : [{ value: facts.consumedOn, label: "Original consumed-on value" }]),
    ...(facts.dateUnknown === true ? [{ label: "Source date", value: "Marked unknown" }] : []),
    ...(facts.animeEpisode === undefined
      ? []
      : [{ label: "Source anime episode", value: formatExactValue(facts.animeEpisode) }]),
    ...(facts.mangaChapter === undefined
      ? []
      : [{ label: "Source manga chapter", value: formatExactValue(facts.mangaChapter) }]),
    ...(facts.mangaVolume === undefined
      ? []
      : [{ label: "Source manga volume", value: formatExactValue(facts.mangaVolume) }]),
    ...(facts.completionKey === undefined
      ? []
      : [{ value: facts.completionKey, label: "Source completion key" }]),
  ];
  return lines.length === 0 ? (
    <span>None recorded</span>
  ) : (
    <dl className="flex flex-col gap-1">
      {lines.map(({ label, value }) => (
        <div key={label}>
          <dt className="inline font-medium text-text">{label}: </dt>
          <dd className="inline">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
