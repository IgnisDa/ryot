import { formatExactValue, periodCaption } from "@ryot-app/plugin-client-sdk/plugin";
import { paginationItems, useReportedPages } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	EmptyState,
	LoadMoreButton,
	SegmentedControl,
	StatusMessage,
} from "@ryot-app/plugin-ui-sdk";
import { RankedBarList } from "@ryot-app/plugin-ui-sdk/charts";
import { DataTable, type DataTableColumn } from "@ryot-app/plugin-ui-sdk/table";
import { useMemo, useState } from "react";

import { analyticsRankingQuery } from "./queries";
import type { AnalyticsRankingRow, AnalyticsScope, WorkoutDrillRequest } from "./reporting-model";

type RankingKind = "targets" | "exercises" | "equipment";

const rankingKinds = [
	{ value: "targets", label: "Targets", content: "Targets" },
	{ value: "exercises", label: "Exercises", content: "Exercises" },
	{ value: "equipment", label: "Equipment", content: "Equipment" },
] as const;

const kindLabel: Readonly<Record<RankingKind, string>> = {
	targets: "targets",
	exercises: "exercises",
	equipment: "equipment",
};

export function AnalyticsRankings(props: {
	readonly compact: boolean;
	readonly scope: AnalyticsScope;
	readonly onOpenWorkouts: (request: WorkoutDrillRequest) => void;
}) {
	const [kind, setKind] = useState<RankingKind>("targets");
	return (
		<section
			aria-label="Historical rankings"
			className={`flex min-w-0 flex-col font-ui ${props.compact ? "gap-3" : "gap-4"}`}
		>
			<SegmentedControl
				fill
				value={kind}
				onChange={setKind}
				label="Ranking kind"
				options={rankingKinds}
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
	id: string,
	header: string,
	unit: string,
	value: (row: AnalyticsRankingRow) => null | number,
): DataTableColumn<AnalyticsRankingRow> => ({
	id,
	header,
	cellClassName,
	headerClassName,
	cell: (row) => formatExactValue(value(row), unit),
});

type RankingTableProps = {
	readonly kind: RankingKind;
	readonly periodCaption: string;
	readonly items: readonly AnalyticsRankingRow[];
	readonly selection: undefined | AnalyticsScope["selection"];
	readonly onOpenWorkouts: (request: WorkoutDrillRequest) => void;
};

const rankingColumns = ({
	kind,
	selection,
	onOpenWorkouts,
	periodCaption: caption,
}: RankingTableProps): DataTableColumn<AnalyticsRankingRow>[] => [
	{
		id: "name",
		header: "Name",
		cell: (row) => row.name,
		cellClassName: "px-3 py-2.5 text-text",
		headerClassName: "px-3 py-2.5 text-left font-medium text-text-muted",
	},
	...(kind === "targets"
		? [countColumn("weighted-sets", "Weighted sets", "weighted sets", (row) => row.weightedSets)]
		: []),
	countColumn("sets", "Recorded sets", "sets", (row) => row.sets),
	countColumn(
		"occurrences",
		"Exercise occurrences",
		"occurrences",
		(row) => row.exerciseOccurrences,
	),
	countColumn("workouts", "Distinct workouts", "workouts", (row) => row.workouts),
	{
		id: "actions",
		headerClassName,
		cellClassName: "px-3 py-2.5 text-right",
		header: <span className="sr-only">Actions</span>,
		cell: (row) => (
			<Button
				size="sm"
				variant="link"
				disabled={selection === undefined}
				aria-label={`View workouts contributing to ${row.name}`}
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
				View workouts
			</Button>
		),
	},
];

function RankingTable(props: RankingTableProps) {
	return (
		<Card padding="none" className="overflow-x-auto">
			<DataTable
				data={props.items}
				getRowId={(row) => row.id}
				columns={rankingColumns(props)}
				rowClassName="border-t border-border"
				aria-label={`${kindLabel[props.kind]} rankings`}
				className="w-full min-w-190 border-collapse text-sm tabular-nums"
			/>
		</Card>
	);
}

function RankingKindResults(props: {
	readonly kind: RankingKind;
	readonly scope: AnalyticsScope;
	readonly onOpenWorkouts: (request: WorkoutDrillRequest) => void;
}) {
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
				return value === null ? [] : [{ value, key: row.id, label: row.name }];
			}),
		[items, kind],
	);
	const measureLabel = kind === "targets" ? "weighted sets" : "recorded sets";
	const previewLabel = kind === "targets" ? "Top weighted sets" : "Top recorded sets";
	const countCaption =
		firstPage === undefined
			? null
			: `${items.length}${result.hasNextPage ? "+" : ""} ${kindLabel[kind]}`;
	let errorMessage = `The ${kindLabel[kind]} rankings couldn't be loaded.`;
	if (result.errorOperation === "append") {
		errorMessage = `More ${kindLabel[kind]} couldn't be loaded.`;
	} else if (result.errorOperation === "refresh") {
		errorMessage = `The ${kindLabel[kind]} rankings couldn't be refreshed.`;
	}
	const heading = `${kindLabel[kind][0]?.toUpperCase()}${kindLabel[kind].slice(1)}`;

	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
				<h2 className="text-heading font-semibold text-text">{heading}</h2>
				<div className="flex items-center gap-3">
					{countCaption === null ? null : (
						<span className="text-label text-text-muted tabular-nums">{countCaption} loaded</span>
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
					{items.length === 0 ? (
						<EmptyState title={`No ${kindLabel[kind]} found`} />
					) : (
						<>
							<section aria-label={previewLabel} className="flex flex-col gap-2">
								<div className="flex items-baseline justify-between gap-3">
									<h3 className="text-body font-semibold text-text">{previewLabel}</h3>
									<span className="text-label text-text-muted">First 10 loaded rows</span>
								</div>
								{preview.length === 0 ? (
									<p className="text-label text-text-muted">
										No known {measureLabel} values in the preview.
									</p>
								) : (
									<RankedBarList
										rows={preview}
										formatValue={(row) => formatExactValue(row.value, measureLabel)}
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
							label={`Show more ${kindLabel[kind]}`}
							isFetchingNextPage={result.isFetchingNextPage}
						/>
					) : null}
				</>
			) : null}
		</div>
	);
}
