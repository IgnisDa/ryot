import {
	formatExactValue,
	periodCaption,
	PluginLink,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import { paginationItems, useReportedPages } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	EmptyState,
	LoadMoreButton,
	Select,
	StatusMessage,
} from "@ryot-app/plugin-ui-sdk";
import { RankedBarList } from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { DataTable, type DataTableColumn } from "@ryot-app/plugin-ui-sdk/table";
import { useMemo, useState } from "react";

import {
	type MediaAnalyticsRanking,
	rankingModel,
	type RankingsRecordsProps,
	type RecordsDrillRequest,
} from "./model";
import { mediaAnalyticsRankingQuery } from "./queries";

type RankingRow = ReturnType<typeof rankingModel>[number];

type RankingTableProps = {
	readonly items: readonly RankingRow[];
	readonly onDrill: (request: RecordsDrillRequest) => void;
	readonly request: (
		row: Pick<MediaAnalyticsRanking["items"][number], "name" | "entityId" | "mediaType">,
	) => null | RecordsDrillRequest;
};
export function MediaAnalyticsRankings(props: RankingsRecordsProps) {
	const viewport = useRyotViewport();
	const [mediaType, setMediaType] = useState<string>();
	const choices = [
		{ value: "", label: "All media types" },
		...props.summary.current.types.map((row) => ({ label: row.label, value: row.mediaType })),
	];
	return (
		<section
			aria-label="Media rankings"
			className={`flex min-w-0 flex-col font-ui ${viewport.compact ? "gap-3" : "gap-4"}`}
		>
			<header className="flex min-w-0 flex-wrap items-baseline justify-between gap-3">
				<div>
					<h2 className="text-heading font-semibold text-text">Rankings</h2>
					<p className="text-label text-text-muted">
						Ranked by active observations in the selected period.
					</p>
				</div>
				<Select
					choices={choices}
					value={mediaType ?? ""}
					label="Ranking media type"
					className="w-full max-w-xs"
					checkIcon={<AppIcon size={14} name="check" />}
					chevronIcon={<AppIcon size={14} name="chevron-down" />}
					onChange={(value) => setMediaType(value === "" ? undefined : value)}
				/>
			</header>
			<RankingResults
				input={props.input}
				mediaType={mediaType}
				summary={props.summary}
				onDrill={props.onDrill}
			/>
		</section>
	);
}

const headerClassName = "px-3 py-2.5 text-left font-medium text-text-muted";
const countHeaderClassName = "px-3 py-2.5 text-right font-medium text-text-muted";
const countCellClassName = "px-3 py-2.5 text-right text-text-muted";

const countColumn = (
	id: string,
	header: string,
	unit: string,
	value: (row: RankingRow) => null | number,
): DataTableColumn<RankingRow> => ({
	id,
	header,
	cellClassName: countCellClassName,
	headerClassName: countHeaderClassName,
	cell: (row) => formatExactValue(value(row), unit),
});

const rankingColumns = ({ request, onDrill }: RankingTableProps): DataTableColumn<RankingRow>[] => [
	{
		id: "name",
		header: "Name",
		headerClassName,
		cellClassName: "px-3 py-2.5",
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
		header: "Category",
		cell: (row) => row.label,
		cellClassName: "px-3 py-2.5 text-text-muted",
	},
	countColumn("active", "Active observations", "observations", (row) => row.activeObservations),
	countColumn("titles", "Title completions", "titles", (row) => row.titleCompletions),
	countColumn("episodes", "Episode completions", "episodes", (row) => row.episodeCompletions),
	{
		id: "actions",
		headerClassName: countHeaderClassName,
		cellClassName: "px-3 py-2.5 text-right",
		header: <span className="sr-only">Actions</span>,
		cell: (row) => {
			const drill = request(row);
			return (
				<Button
					size="sm"
					variant="link"
					disabled={drill === null}
					aria-label={`View records contributing to ${row.name}`}
					onClick={() => {
						if (drill !== null) {
							onDrill(drill);
						}
					}}
				>
					View records
				</Button>
			);
		},
	},
];

function RankingTable(props: RankingTableProps) {
	return (
		<Card padding="none" className="overflow-x-auto">
			<DataTable
				data={props.items}
				columns={rankingColumns(props)}
				getRowId={(row) => row.entityId}
				aria-label="Media entity rankings"
				rowClassName="border-t border-border"
				className="w-full min-w-190 border-collapse text-sm tabular-nums"
			/>
		</Card>
	);
}

function RankingResults(props: {
	readonly mediaType: string | undefined;
	readonly input: RankingsRecordsProps["input"];
	readonly summary: RankingsRecordsProps["summary"];
	readonly onDrill: RankingsRecordsProps["onDrill"];
}) {
	const result = useReportedPages(mediaAnalyticsRankingQuery, {
		...props.input,
		processing: props.summary.processing,
		...(props.mediaType === undefined ? {} : { mediaType: props.mediaType }),
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
	const modeledRows = useMemo(
		() => rankingModel(rows, props.summary.processing),
		[props.summary.processing, rows],
	);
	const firstPage = result.pages[0];
	const preview = useMemo(
		() =>
			modeledRows
				.slice(0, 10)
				.flatMap((row) =>
					row.activeObservations === null
						? []
						: [{ label: row.name, key: row.entityId, value: row.activeObservations }],
				),
		[modeledRows],
	);
	const loadedCaption =
		firstPage === undefined
			? null
			: `${rows.length}${result.hasNextPage ? "+" : ""} ${rows.length === 1 ? "entity" : "entities"}`;
	let errorMessage = "The rankings couldn't be loaded.";
	if (result.errorOperation === "append") {
		errorMessage = "More rankings couldn't be loaded.";
	} else if (result.errorOperation === "refresh") {
		errorMessage = "The rankings couldn't be refreshed.";
	}
	const requestFor = (
		row: Pick<MediaAnalyticsRanking["items"][number], "name" | "entityId" | "mediaType">,
	): null | RecordsDrillRequest => {
		if (firstPage === undefined) {
			return null;
		}
		return {
			title: row.name,
			activeOnly: true,
			entityId: row.entityId,
			mediaType: row.mediaType,
			selection: firstPage.reporting.selection,
			periodCaption: periodCaption(firstPage.reporting.resolved.current),
		};
	};
	const allRecordsRequest: null | RecordsDrillRequest =
		firstPage === undefined
			? null
			: {
					...(props.mediaType === undefined ? {} : { mediaType: props.mediaType }),
					activeOnly: false,
					title: "All records",
					selection: firstPage.reporting.selection,
					periodCaption: periodCaption(firstPage.reporting.resolved.current),
				};
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
				<h3 className="text-body font-semibold text-text">Ranked entities</h3>
				<div className="flex items-center gap-3">
					{loadedCaption === null ? null : (
						<span className="text-label text-text-muted tabular-nums">{loadedCaption} loaded</span>
					)}
					<Button
						size="sm"
						variant="secondary"
						onClick={result.refetch}
						disabled={result.isFetching}
					>
						Refresh
					</Button>
				</div>
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
				<StatusMessage tone="pending">Loading rankings…</StatusMessage>
			) : null}
			{result.pages.length > 0 ? (
				<>
					{result.operation === "refresh" ? (
						<StatusMessage tone="pending">Refreshing rankings…</StatusMessage>
					) : null}
					{result.isError ? (
						<StatusMessage
							tone="error"
							action={{ label: "Try again", onClick: result.retry, disabled: result.isFetching }}
						>
							{errorMessage}
						</StatusMessage>
					) : null}
					{props.summary.processing === "ready" ? null : (
						<StatusMessage tone={props.summary.processing === "failed" ? "error" : "pending"}>
							Ranking counts are unavailable while consumption processing is{" "}
							{props.summary.processing}.
						</StatusMessage>
					)}
					{rows.length === 0 ? (
						<EmptyState title="No ranked entities" />
					) : (
						<>
							<section className="flex flex-col gap-2" aria-label="Top active observations">
								<div className="flex items-baseline justify-between gap-3">
									<h4 className="text-body font-semibold text-text">Top active observations</h4>
									<span className="text-label text-text-muted">First 10 loaded rows</span>
								</div>
								{preview.length === 0 ? (
									<p className="text-label text-text-muted">
										No available active-observation counts in the preview.
									</p>
								) : (
									<RankedBarList
										rows={preview}
										formatValue={({ value }) => formatExactValue(value, "observations")}
									/>
								)}
							</section>
							<RankingTable items={modeledRows} request={requestFor} onDrill={props.onDrill} />
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
							All records
						</Button>
					</div>
					{result.hasNextPage && !result.isError ? (
						<LoadMoreButton
							variant="secondary"
							className="self-center"
							label="Show more rankings"
							disabled={result.isFetching}
							onClick={result.fetchNextPage}
							isFetchingNextPage={result.isFetchingNextPage}
						/>
					) : null}
				</>
			) : null}
		</div>
	);
}
