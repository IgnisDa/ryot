import { PluginLink, usePeriodCaption, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import {
	paginationItems,
	useDisplayText,
	useReportedPages,
	useT,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	EmptyState,
	LoadMoreButton,
	type MetricFormat,
	type MetricUnit,
	ReportText,
	Select,
	StatusMessage,
	useMetricFormat,
} from "@ryot-app/plugin-ui-sdk";
import { RankedBarList } from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { DataTable, type DataTableColumn } from "@ryot-app/plugin-ui-sdk/table";
import { useMemo, useState } from "react";

import { type MediaText, useMediaMessages } from "../messages";
import {
	type AnalyticsDrillMediaType,
	type MediaAnalyticsRanking,
	type RankingsRecordsProps,
	type RecordsDrillRequest,
	useAnalyticsUnits,
} from "./model";
import { mediaAnalyticsRankingQuery } from "./queries";

type RankingRow = MediaAnalyticsRanking["items"][number];

type RankingTableProps = {
	readonly items: readonly RankingRow[];
	readonly onDrill: (request: RecordsDrillRequest) => void;
	readonly request: (
		row: Pick<RankingRow, "name" | "label" | "entityId" | "mediaType">,
	) => null | RecordsDrillRequest;
};
export function MediaAnalyticsRankings(props: RankingsRecordsProps) {
	const viewport = useRyotViewport();
	const t = useT();
	const text = useMediaMessages();
	const [mediaType, setMediaType] = useState<string>();
	const types = props.summary.current.types;
	const choices = [
		{ value: "", label: text("analytics.charts.all-media-types") },
		...types.map((row) => ({ label: t(row.label), value: row.mediaType })),
	];
	const selectedRow = types.find((row) => row.mediaType === mediaType);
	const drillType =
		selectedRow === undefined
			? undefined
			: { slug: selectedRow.mediaType, label: t(selectedRow.label) };
	return (
		<section
			aria-label={text("analytics.rankings.aria-label")}
			className={`flex min-w-0 flex-col font-ui ${viewport.compact ? "gap-3" : "gap-4"}`}
		>
			<header className="flex min-w-0 flex-wrap items-baseline justify-between gap-3">
				<div>
					<h2 className="text-heading font-semibold text-text">
						{text("analytics.rankings.title")}
					</h2>
					<ReportText>
						<p className="text-label text-text-muted">{text("analytics.rankings.description")}</p>
					</ReportText>
				</div>
				<Select
					choices={choices}
					value={mediaType ?? ""}
					className="w-full max-w-xs"
					label={text("analytics.rankings.type-label")}
					checkIcon={<AppIcon size={14} name="check" />}
					chevronIcon={<AppIcon size={14} name="chevron-down" />}
					onChange={(value) => setMediaType(value === "" ? undefined : value)}
				/>
			</header>
			<RankingResults input={props.input} mediaType={drillType} onDrill={props.onDrill} />
		</section>
	);
}

const headerClassName = "px-3 py-2.5 text-left font-medium text-text-muted";
const countHeaderClassName = "px-3 py-2.5 text-right font-medium text-text-muted";
const countCellClassName = "px-3 py-2.5 text-right text-text-muted";

const countColumn = (
	format: MetricFormat,
	id: string,
	header: string,
	unit: MetricUnit,
	value: (row: RankingRow) => null | number,
): DataTableColumn<RankingRow> => ({
	id,
	header,
	cellClassName: countCellClassName,
	headerClassName: countHeaderClassName,
	cell: (row) => format.formatMetric(value(row), unit),
});

const rankingColumns = (
	{ request, onDrill }: RankingTableProps,
	t: ReturnType<typeof useT>,
	text: MediaText,
	units: ReturnType<typeof useAnalyticsUnits>,
	format: MetricFormat,
): DataTableColumn<RankingRow>[] => [
	{
		id: "name",
		headerClassName,
		cellClassName: "px-3 py-2.5",
		header: text("property.name"),
		cell: (row) => (
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
		cell: (row) => t(row.label),
		header: text("analytics.table.category"),
		cellClassName: "px-3 py-2.5 text-text-muted",
	},
	countColumn(
		format,
		"active",
		text("analytics.metric.activity-entries"),
		units.entryUnit,
		(row) => row.activeObservations,
	),
	countColumn(
		format,
		"titles",
		text("analytics.metric.titles-completed"),
		units.titleUnit,
		(row) => row.titleCompletions,
	),
	countColumn(
		format,
		"episodes",
		text("analytics.metric.episodes-finished"),
		units.episodeUnit,
		(row) => row.episodeCompletions,
	),
	{
		id: "actions",
		report: false,
		headerClassName: countHeaderClassName,
		cellClassName: "px-3 py-2.5 text-right",
		header: <span className="sr-only">{text("analytics.rankings.actions")}</span>,
		cell: (row) => {
			const drill = request(row);
			return (
				<Button
					size="sm"
					variant="link"
					disabled={drill === null}
					aria-label={text("analytics.rankings.view-records-label", { name: row.name })}
					onClick={() => {
						if (drill !== null) {
							onDrill(drill);
						}
					}}
				>
					{text("analytics.rankings.view-records")}
				</Button>
			);
		},
	},
];

function RankingTable(props: RankingTableProps) {
	const t = useT();
	const text = useMediaMessages();
	const units = useAnalyticsUnits();
	const format = useMetricFormat();
	return (
		<Card padding="none" className="overflow-x-auto">
			<DataTable
				data={props.items}
				getRowId={(row) => row.entityId}
				rowClassName="border-t border-border"
				aria-label={text("analytics.rankings.table-label")}
				columns={rankingColumns(props, t, text, units, format)}
				className="w-full min-w-190 border-collapse text-sm tabular-nums"
			/>
		</Card>
	);
}

function RankingResults(props: {
	readonly input: RankingsRecordsProps["input"];
	readonly onDrill: RankingsRecordsProps["onDrill"];
	readonly mediaType: undefined | AnalyticsDrillMediaType;
}) {
	const periodCaption = usePeriodCaption();
	const t = useT();
	const text = useMediaMessages();
	const displayText = useDisplayText();
	const { entryUnit } = useAnalyticsUnits();
	const { formatMetric } = useMetricFormat();
	const result = useReportedPages(mediaAnalyticsRankingQuery, {
		...props.input,
		...(props.mediaType === undefined ? {} : { mediaType: props.mediaType.slug }),
	});
	const rows = useMemo(
		() =>
			paginationItems(
				result.pages,
				(page) => page.items,
				({ entityId }) => entityId,
			),
		[result.pages],
	);
	const firstPage = result.pages[0];
	const preview = useMemo(
		() =>
			rows
				.slice(0, 10)
				.map((row) => ({
					key: row.entityId,
					label: displayText(row.name),
					value: row.activeObservations ?? 0,
				})),
		[displayText, rows],
	);
	const loadedCaption =
		firstPage === undefined
			? null
			: text("analytics.rankings.loaded", {
					count: rows.length,
					more: result.hasNextPage ? "more" : "all",
				});
	let errorMessage = text("analytics.rankings.load-failed");
	if (result.errorOperation === "append") {
		errorMessage = text("analytics.rankings.load-more-failed");
	} else if (result.errorOperation === "refresh") {
		errorMessage = text("analytics.rankings.refresh-failed");
	}
	const requestFor = (
		row: Pick<RankingRow, "name" | "label" | "entityId" | "mediaType">,
	): null | RecordsDrillRequest => {
		if (firstPage === undefined) {
			return null;
		}
		return {
			title: row.name,
			activeOnly: true,
			entityId: row.entityId,
			selection: firstPage.reporting.selection,
			mediaType: { slug: row.mediaType, label: t(row.label) },
			periodCaption: periodCaption(firstPage.reporting.resolved.current),
		};
	};
	const allRecordsRequest: null | RecordsDrillRequest =
		firstPage === undefined
			? null
			: {
					...(props.mediaType === undefined ? {} : { mediaType: props.mediaType }),
					activeOnly: false,
					selection: firstPage.reporting.selection,
					title: text("analytics.rankings.all-records"),
					periodCaption: periodCaption(firstPage.reporting.resolved.current),
				};
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
				<h3 className="text-body font-semibold text-text">
					{text("analytics.rankings.ranked-entities")}
				</h3>
				<div className="flex items-center gap-3">
					{loadedCaption === null ? null : (
						<ReportText>
							<span className="text-label text-text-muted tabular-nums">{loadedCaption}</span>
						</ReportText>
					)}
					<Button
						size="sm"
						variant="secondary"
						onClick={result.refetch}
						disabled={result.isFetching}
					>
						{text("common.action.refresh")}
					</Button>
				</div>
			</div>
			{result.pages.length === 0 && result.isError ? (
				<StatusMessage
					blocked
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
				<StatusMessage blocked tone="pending">
					{text("analytics.rankings.loading")}
				</StatusMessage>
			) : null}
			{result.pages.length > 0 ? (
				<>
					{result.operation === "refresh" ? (
						<StatusMessage tone="pending">{text("analytics.rankings.refreshing")}</StatusMessage>
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
					{rows.length === 0 ? (
						<EmptyState title={text("analytics.rankings.empty")} />
					) : (
						<>
							<section
								className="flex flex-col gap-2"
								aria-label={text("analytics.rankings.top-title")}
							>
								<div className="flex items-baseline justify-between gap-3">
									<h4 className="text-body font-semibold text-text">
										{text("analytics.rankings.top-title")}
									</h4>
									<ReportText>
										<span className="text-label text-text-muted">
											{text("analytics.rankings.top-caption")}
										</span>
									</ReportText>
								</div>
								<RankedBarList
									rows={preview}
									formatValue={({ value }) => formatMetric(value, entryUnit)}
								/>
							</section>
							<RankingTable items={rows} request={requestFor} onDrill={props.onDrill} />
						</>
					)}
					<div className="flex justify-end">
						<Button
							variant="secondary"
							disabled={allRecordsRequest === null}
							onClick={() => {
								if (allRecordsRequest !== null) {
									props.onDrill(allRecordsRequest);
								}
							}}
						>
							{text("analytics.rankings.all-records")}
						</Button>
					</div>
					{result.hasNextPage && !result.isError ? (
						<LoadMoreButton
							variant="secondary"
							className="self-center"
							disabled={result.isFetching}
							onClick={result.fetchNextPage}
							label={text("analytics.rankings.show-more")}
							isFetchingNextPage={result.isFetchingNextPage}
						/>
					) : null}
				</>
			) : null}
		</div>
	);
}
