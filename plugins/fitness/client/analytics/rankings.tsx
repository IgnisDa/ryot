import { usePeriodCaption } from "@ryot-app/plugin-client-sdk/plugin";
import {
	paginationItems,
	useDisplayText,
	useReportedPages,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	EmptyState,
	LoadMoreButton,
	type MetricFormat,
	type MetricUnit,
	ReportText,
	SegmentedControl,
	StatusMessage,
	useMetricFormat,
} from "@ryot-app/plugin-ui-sdk";
import { RankedBarList } from "@ryot-app/plugin-ui-sdk/charts";
import { DataTable, type DataTableColumn } from "@ryot-app/plugin-ui-sdk/table";
import { useMemo, useState } from "react";

import { type FitnessText, useCountUnits, useFitnessMessages } from "../messages";
import { analyticsRankingQuery } from "./queries";
import type { AnalyticsRankingRow, AnalyticsScope, WorkoutDrillRequest } from "./reporting-model";

type RankingKind = "targets" | "exercises" | "equipment";

const rankingKindOptions = (text: FitnessText) =>
	[
		{
			value: "targets",
			label: text("client.analytics.rankings.kind-targets"),
			content: text("client.analytics.rankings.kind-targets"),
		},
		{ value: "exercises", label: text("property.exercises"), content: text("property.exercises") },
		{
			value: "equipment",
			label: text("client.analytics.rankings.kind-equipment"),
			content: text("client.analytics.rankings.kind-equipment"),
		},
	] as const;

export function AnalyticsRankings(props: {
	readonly compact: boolean;
	readonly scope: AnalyticsScope;
	readonly onOpenWorkouts: (request: WorkoutDrillRequest) => void;
}) {
	const text = useFitnessMessages();
	const [kind, setKind] = useState<RankingKind>("targets");
	return (
		<section
			aria-label={text("client.analytics.rankings.label")}
			className={`flex min-w-0 flex-col font-ui ${props.compact ? "gap-3" : "gap-4"}`}
		>
			<SegmentedControl
				fill
				value={kind}
				onChange={setKind}
				options={rankingKindOptions(text)}
				label={text("client.analytics.rankings.kind-label")}
			/>
			<RankingKindResults
				key={kind}
				kind={kind}
				scope={props.scope}
				onOpenWorkouts={props.onOpenWorkouts}
			/>
		</section>
	);
}

const headerClassName = "px-3 py-2.5 text-right font-medium text-text-muted";
const cellClassName = "px-3 py-2.5 text-right text-text-muted";

const countColumn = (
	format: MetricFormat,
	id: string,
	header: string,
	unit: MetricUnit,
	value: (row: AnalyticsRankingRow) => null | number,
): DataTableColumn<AnalyticsRankingRow> => ({
	id,
	header,
	cellClassName,
	headerClassName,
	cell: (row) => format.formatMetric(value(row), unit),
});

type RankingTableProps = {
	readonly kind: RankingKind;
	readonly periodCaption: string;
	readonly items: readonly AnalyticsRankingRow[];
	readonly selection: undefined | AnalyticsScope["selection"];
	readonly onOpenWorkouts: (request: WorkoutDrillRequest) => void;
};

const rankingColumns = (
	{ kind, selection, onOpenWorkouts, periodCaption: caption }: RankingTableProps,
	format: MetricFormat,
	text: FitnessText,
	units: ReturnType<typeof useCountUnits>,
): DataTableColumn<AnalyticsRankingRow>[] => [
	{
		id: "name",
		cell: (row) => row.name,
		header: text("table-column.name"),
		cellClassName: "px-3 py-2.5 text-text",
		headerClassName: "px-3 py-2.5 text-left font-medium text-text-muted",
	},
	...(kind === "targets"
		? [
				countColumn(
					format,
					"weighted-sets",
					text("client.analytics.rankings.column-weighted-sets"),
					units("weighted_set"),
					(row) => row.weightedSets,
				),
			]
		: []),
	countColumn(
		format,
		"sets",
		text("client.analytics.rankings.column-sets"),
		units("set"),
		(row) => row.sets,
	),
	countColumn(
		format,
		"occurrences",
		text("client.analytics.rankings.column-occurrences"),
		units("occurrence"),
		(row) => row.exerciseOccurrences,
	),
	countColumn(
		format,
		"workouts",
		text("client.analytics.rankings.column-workouts"),
		units("workout"),
		(row) => row.workouts,
	),
	{
		id: "actions",
		report: false,
		headerClassName,
		cellClassName: "px-3 py-2.5 text-right",
		header: <span className="sr-only">{text("client.measurements.column-actions")}</span>,
		cell: (row) => (
			<Button
				size="sm"
				variant="link"
				disabled={selection === undefined}
				aria-label={text("client.analytics.rankings.view-workouts-label", { name: row.name })}
				onClick={() => {
					if (selection !== undefined) {
						onOpenWorkouts({
							selection,
							title: row.name,
							periodCaption: caption,
							filter: { kind, id: row.id },
						});
					}
				}}
			>
				{text("client.analytics.rankings.view-workouts")}
			</Button>
		),
	},
];

function RankingTable(props: RankingTableProps) {
	const text = useFitnessMessages();
	const units = useCountUnits();
	const format = useMetricFormat();
	return (
		<Card padding="none" className="overflow-x-auto">
			<DataTable
				data={props.items}
				getRowId={(row) => row.id}
				rowClassName="border-t border-border"
				columns={rankingColumns(props, format, text, units)}
				className="w-full min-w-190 border-collapse text-sm tabular-nums"
				aria-label={text("client.analytics.rankings.table-label", { kind: props.kind })}
			/>
		</Card>
	);
}

function RankingKindResults(props: {
	readonly kind: RankingKind;
	readonly scope: AnalyticsScope;
	readonly onOpenWorkouts: (request: WorkoutDrillRequest) => void;
}) {
	const displayText = useDisplayText();
	const text = useFitnessMessages();
	const units = useCountUnits();
	const periodCaption = usePeriodCaption();
	const { formatMetric } = useMetricFormat();
	const { kind, scope } = props;
	const result = useReportedPages(analyticsRankingQuery, { ...scope, kind });
	const items = useMemo(
		() =>
			paginationItems(
				result.pages,
				(page) => page.items,
				({ id }) => id,
			),
		[result.pages],
	);
	const firstPage = result.pages[0];
	const preview = useMemo(
		() =>
			items.slice(0, 10).flatMap((row) => {
				const value = kind === "targets" ? row.weightedSets : row.sets;
				return value === null ? [] : [{ value, key: row.id, label: displayText(row.name) }];
			}),
		[displayText, items, kind],
	);
	const previewLabel =
		kind === "targets"
			? text("client.analytics.rankings.preview-weighted")
			: text("client.analytics.rankings.preview-recorded");
	let countCaption: null | string = null;
	if (firstPage !== undefined) {
		countCaption = text(
			result.hasNextPage
				? "client.analytics.rankings.count-loaded-more"
				: "client.analytics.rankings.count-loaded",
			{ kind, count: items.length },
		);
	}
	let errorMessage = text("client.analytics.rankings.load-failed", { kind });
	if (result.errorOperation === "append") {
		errorMessage = text("client.analytics.rankings.append-failed", { kind });
	} else if (result.errorOperation === "refresh") {
		errorMessage = text("client.analytics.rankings.refresh-failed", { kind });
	}
	const heading = text("client.analytics.rankings.heading", { kind });

	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
				<h2 className="text-heading font-semibold text-text">{heading}</h2>
				<div className="flex items-center gap-3">
					{countCaption === null ? null : (
						<ReportText>
							<span className="text-label text-text-muted tabular-nums">{countCaption}</span>
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
					{text("client.analytics.rankings.loading")}
				</StatusMessage>
			) : null}
			{result.pages.length > 0 ? (
				<>
					{result.operation === "refresh" ? (
						<StatusMessage tone="pending">
							{text("client.analytics.rankings.refreshing")}
						</StatusMessage>
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
						<EmptyState title={text("client.analytics.rankings.empty", { kind })} />
					) : (
						<>
							<section aria-label={previewLabel} className="flex flex-col gap-2">
								<div className="flex items-baseline justify-between gap-3">
									<h3 className="text-body font-semibold text-text">{previewLabel}</h3>
									<ReportText>
										<span className="text-label text-text-muted">
											{text("client.analytics.rankings.preview-note")}
										</span>
									</ReportText>
								</div>
								{preview.length === 0 ? (
									<ReportText>
										<p className="text-label text-text-muted">
											{text("client.analytics.rankings.preview-empty", {
												measure: kind === "targets" ? "weighted" : "recorded",
											})}
										</p>
									</ReportText>
								) : (
									<RankedBarList
										rows={preview}
										formatValue={(row) =>
											formatMetric(
												row.value,
												kind === "targets" ? units("weighted_set") : units("set"),
											)
										}
									/>
								)}
							</section>
							<RankingTable
								kind={kind}
								items={items}
								onOpenWorkouts={props.onOpenWorkouts}
								selection={firstPage?.reporting.selection}
								periodCaption={periodCaption(firstPage?.reporting.resolved.current ?? null)}
							/>
						</>
					)}
					{result.hasNextPage && !result.isError ? (
						<LoadMoreButton
							variant="secondary"
							className="self-center"
							disabled={result.isFetching}
							onClick={result.fetchNextPage}
							isFetchingNextPage={result.isFetchingNextPage}
							label={text("client.analytics.rankings.show-more", { kind })}
						/>
					) : null}
				</>
			) : null}
		</div>
	);
}
