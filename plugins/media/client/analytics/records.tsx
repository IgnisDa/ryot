import { PluginLink, type TimeZone, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import {
	paginationItems,
	useFormatters,
	useReportedPages,
	useT,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	Dialog,
	EmptyState,
	LoadMoreButton,
	type MetricFormat,
	MotionPresence,
	percentUnit,
	StatusMessage,
	useMetricFormat,
} from "@ryot-app/plugin-ui-sdk";
import { formatReportingDateTime } from "@ryot-app/plugin-ui-sdk/charts";
import { DataTable, type DataTableColumn } from "@ryot-app/plugin-ui-sdk/table";
import { useMemo } from "react";

import { type MediaText, useMediaMessages } from "../messages";
import {
	analyticsHourLabel,
	type AnalyticsInput,
	type MediaAnalyticsRecord,
	recordModel,
	type RecordsDrillRequest,
	useAnalyticsUnits,
} from "./model";
import { mediaAnalyticsRecordsQuery } from "./queries";

const exact = (text: MediaText, format: MetricFormat, value: null | number) =>
	value === null ? text("analytics.records.unknown") : format.formatNumber(value);

type RecordRow = ReturnType<typeof recordModel>;

type RecordTableProps = {
	readonly timeZone: TimeZone;
	readonly items: readonly MediaAnalyticsRecord[];
};
export function MediaAnalyticsRecords(props: {
	readonly onClose: () => void;
	readonly input: AnalyticsInput;
	readonly request: RecordsDrillRequest;
}) {
	const viewport = useRyotViewport();
	const text = useMediaMessages();
	const formatters = useFormatters();
	const result = useReportedPages(mediaAnalyticsRecordsQuery, {
		timeZone: props.input.timeZone,
		reference: props.input.reference,
		selection: props.request.selection,
		...(props.request.entityId === undefined ? {} : { entityId: props.request.entityId }),
		...(props.request.mediaType === undefined ? {} : { mediaType: props.request.mediaType.slug }),
		...(props.request.hour === undefined ? {} : { hour: props.request.hour }),
		...(props.request.activeOnly === undefined ? {} : { activeOnly: props.request.activeOnly }),
	});
	const firstPage = result.pages[0];
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
			: text("analytics.records.loaded", {
					count: items.length,
					more: result.hasNextPage ? "more" : "all",
				});
	let errorMessage = text("analytics.records.load-failed");
	if (result.errorOperation === "append") {
		errorMessage = text("analytics.records.load-more-failed");
	} else if (result.errorOperation === "refresh") {
		errorMessage = text("analytics.records.refresh-failed");
	}
	const heading = text("analytics.charts.title-with-period", {
		label: props.request.title,
		period: props.request.periodCaption,
	});
	const filters = [
		...(props.request.mediaType === undefined
			? []
			: [text("analytics.records.filter-type", { type: props.request.mediaType.label })]),
		...(props.request.hour === undefined
			? []
			: [
					text("analytics.records.filter-hour", {
						hour: analyticsHourLabel(formatters, props.request.hour),
					}),
				]),
		...(props.request.activeOnly === true ? [text("analytics.records.filter-active")] : []),
	];
	const timeZone = firstPage?.reporting.resolved.timeZone ?? text("common.status.loading");
	return (
		<MotionPresence>
			<Dialog
				size="lg"
				title={heading}
				onClose={props.onClose}
				key="media-analytics-records"
				safeAreaBottom={viewport.safeAreaBottom}
				placement={viewport.compact ? "sheet" : "center"}
				closeLabel={text("analytics.records.close-label")}
				footer={
					<Button variant="secondary" onClick={props.onClose}>
						{text("common.action.close")}
					</Button>
				}
			>
				<section
					className="flex min-w-0 flex-col gap-3"
					aria-label={text("analytics.records.section-label", { title: props.request.title })}
				>
					<p className="text-label text-text-muted">
						{filters.length === 0
							? text("analytics.records.context", { timeZone, period: props.request.periodCaption })
							: text("analytics.records.context-filtered", {
									timeZone,
									filters: filters.join(" · "),
									period: props.request.periodCaption,
								})}
					</p>
					<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
						{loadedCaption === null ? null : (
							<span className="text-label text-text-muted tabular-nums">{loadedCaption}</span>
						)}
						<Button
							size="sm"
							variant="secondary"
							onClick={result.refetch}
							disabled={result.isFetching}
						>
							{text("analytics.records.refresh")}
						</Button>
					</div>
					{result.pages.length === 0 && result.isError ? (
						<StatusMessage
							tone="error"
							action={{
								onClick: result.retry,
								disabled: result.isFetching,
								label: text("common.action.try-again"),
							}}
						>
							{errorMessage}
						</StatusMessage>
					) : null}
					{result.pages.length === 0 && !result.isError ? (
						<StatusMessage tone="pending">{text("analytics.records.loading")}</StatusMessage>
					) : null}
					{firstPage !== undefined ? (
						<>
							{result.operation === "refresh" ? (
								<StatusMessage tone="pending">{text("analytics.records.refreshing")}</StatusMessage>
							) : null}
							{result.isError ? (
								<StatusMessage
									tone="error"
									action={{
										onClick: result.retry,
										disabled: result.isFetching,
										label: text("common.action.try-again"),
									}}
								>
									{errorMessage}
								</StatusMessage>
							) : null}
							{items.length === 0 ? (
								<EmptyState title={text("analytics.records.empty")} />
							) : (
								<RecordTable items={items} timeZone={firstPage.reporting.resolved.timeZone} />
							)}
							{result.hasNextPage && !result.isError ? (
								<LoadMoreButton
									variant="secondary"
									className="self-center"
									disabled={result.isFetching}
									onClick={result.fetchNextPage}
									label={text("analytics.records.show-more")}
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

function Term(props: { readonly label: string }) {
	const text = useMediaMessages();
	return (
		<dt className="inline font-medium text-text">
			{text("analytics.records.term", { label: props.label })}
		</dt>
	);
}

function RecordDate(props: { readonly timeZone: TimeZone; readonly row: MediaAnalyticsRecord }) {
	const formatters = useFormatters();
	const text = useMediaMessages();
	const attribution = props.row.contribution.attribution;
	const modeled = recordModel(text, props.row);
	if (attribution.kind === "unknown") {
		return <span>{modeled.date}</span>;
	}
	if (attribution.kind === "date") {
		return <time dateTime={attribution.value}>{modeled.date}</time>;
	}
	return (
		<time dateTime={attribution.value}>
			{formatReportingDateTime(formatters, attribution.value, props.timeZone)}
		</time>
	);
}
function Contribution(props: { readonly contribution: MediaAnalyticsRecord["contribution"] }) {
	const format = useMetricFormat();
	const text = useMediaMessages();
	const contribution = props.contribution;
	const measures = [
		["pages", contribution.pages],
		["minutes", contribution.minutes],
		["volumes", contribution.volumes],
		["episodes", contribution.episodes],
		["chapters", contribution.chapters],
	] as const;
	return (
		<dl className="flex flex-col gap-1">
			<div>
				<Term label={text("property.active-observation")} />{" "}
				<dd className="inline">
					{contribution.activeObservation ? text("common.value.yes") : text("common.value.no")}
				</dd>
			</div>
			<div>
				<Term label={text("property.title-completions")} />{" "}
				<dd className="inline">{exact(text, format, contribution.titleCompletions)}</dd>
			</div>
			<div>
				<Term label={text("property.episode-completions")} />{" "}
				<dd className="inline">{exact(text, format, contribution.episodeCompletions)}</dd>
			</div>
			{measures.map(([unit, measure]) =>
				measure === undefined ? null : (
					<div key={unit}>
						<Term label={text("analytics.records.measure", { unit })} />{" "}
						<dd className="inline">
							{text("analytics.records.measure-detail", {
								missing: measure.missing ? "yes" : "no",
								recorded: exact(text, format, measure.recorded),
								estimated: exact(text, format, measure.estimated),
								superseded: measure.supersededEstimate ? "yes" : "no",
							})}
						</dd>
					</div>
				),
			)}
		</dl>
	);
}

const headerClassName = "px-3 py-2.5 text-left font-medium text-text-muted";

const recordColumns = (
	{ timeZone }: RecordTableProps,
	t: ReturnType<typeof useT>,
	text: MediaText,
): DataTableColumn<RecordRow>[] => [
	{
		id: "name",
		headerClassName,
		cellClassName: "px-3 py-2.5",
		header: text("property.name"),
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
		cell: ({ source: row }) => t(row.label),
		header: text("analytics.table.category"),
		cellClassName: "px-3 py-2.5 text-text-muted",
	},
	{
		headerClassName,
		id: "event-type",
		cell: ({ source: row }) => t(row.eventLabel),
		cellClassName: "px-3 py-2.5 text-text-muted",
		header: text("analytics.records.column-event-type"),
	},
	{
		id: "date",
		headerClassName,
		header: text("analytics.records.column-date"),
		cellClassName: "whitespace-nowrap px-3 py-2.5 text-text-muted",
		cell: ({ source: row }) => <RecordDate row={row} timeZone={timeZone} />,
	},
	{
		id: "facts",
		headerClassName,
		header: text("analytics.records.column-facts"),
		cellClassName: "min-w-55 px-3 py-2.5 text-text-muted",
		cell: (modeled) => <SourceFacts modeled={modeled} row={modeled.source} />,
	},
	{
		headerClassName,
		id: "contribution",
		header: text("analytics.records.column-contribution"),
		cellClassName: "min-w-64 px-3 py-2.5 text-text-muted",
		cell: ({ source }) => <Contribution contribution={source.contribution} />,
	},
];

function RecordTable(props: RecordTableProps) {
	const t = useT();
	const text = useMediaMessages();
	return (
		<Card padding="none" className="overflow-x-auto">
			<DataTable
				getRowId={({ source }) => source.id}
				columns={recordColumns(props, t, text)}
				rowClassName="border-t border-border align-top"
				aria-label={text("analytics.records.table-label")}
				data={props.items.map((row) => recordModel(text, row))}
				className="w-full min-w-240 border-collapse text-sm tabular-nums"
			/>
		</Card>
	);
}

function SourceFacts(props: {
	readonly row: MediaAnalyticsRecord;
	readonly modeled: ReturnType<typeof recordModel>;
}) {
	const format = useMetricFormat();
	const formatters = useFormatters();
	const text = useMediaMessages();
	const units = useAnalyticsUnits();
	const { facts } = props.row;
	const lines = [
		...(props.modeled.position === null
			? []
			: [
					{
						value: props.modeled.position,
						label:
							props.row.eventType === "item-complete"
								? text("analytics.records.fact-item-position")
								: text("property.source-position"),
					},
				]),
		...(props.modeled.manualMinutes === null
			? []
			: [
					{
						label: text("analytics.records.fact-manual-time"),
						value: format.formatMetric(props.modeled.manualMinutes, units.measureUnits.minutes),
					},
				]),
		...(props.modeled.sourceProgress === null
			? []
			: [{ value: props.modeled.sourceProgress, label: text("analytics.records.fact-progress") }]),
		...(facts.progressPages === undefined
			? []
			: [
					{
						label: text("analytics.records.fact-progress-pages"),
						value: format.formatMetric(facts.progressPages, units.measureUnits.pages),
					},
				]),
		...(facts.progressPercent === undefined
			? []
			: [
					{
						label: text("analytics.records.fact-progress-percent"),
						value: format.formatMetric(facts.progressPercent, percentUnit),
					},
				]),
		...(facts.consumptionBasis === undefined
			? []
			: [
					{
						label: text("analytics.records.fact-basis"),
						value: [
							facts.consumptionBasis.unit,
							...(facts.consumptionBasis.total === undefined
								? []
								: [
										text("analytics.records.basis-total", {
											total: exact(text, format, facts.consumptionBasis.total),
										}),
									]),
							...(facts.consumptionBasis.property === undefined
								? []
								: [
										text("analytics.records.basis-property", {
											property: facts.consumptionBasis.property,
										}),
									]),
						].join(" · "),
					},
				]),
		...(facts.calendarDate === undefined
			? []
			: [{ value: facts.calendarDate, label: text("analytics.records.fact-calendar-date") }]),
		...(facts.consumedOn === undefined
			? []
			: [
					{
						label: text("analytics.records.fact-consumed-on"),
						value: formatters.list({ type: "unit", style: "short" }).format(facts.consumedOn),
					},
				]),
		...(facts.dateUnknown === true
			? [
					{
						label: text("analytics.records.fact-date"),
						value: text("analytics.records.date-unknown"),
					},
				]
			: []),
		...(facts.completionKey === undefined
			? []
			: [{ value: facts.completionKey, label: text("analytics.records.fact-completion-key") }]),
	];
	return lines.length === 0 ? (
		<span>{text("analytics.records.none")}</span>
	) : (
		<dl className="flex flex-col gap-1">
			{lines.map(({ label, value }) => (
				<div key={label}>
					<Term label={label} /> <dd className="inline">{value}</dd>
				</div>
			))}
		</dl>
	);
}
