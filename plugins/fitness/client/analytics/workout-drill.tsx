import { PluginLink, type TimeZone, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import {
	type Formatters,
	paginationItems,
	useFormatters,
	useReportedPages,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	Dialog,
	durationUnit,
	EmptyState,
	LoadMoreButton,
	type MetricFormat,
	StatusMessage,
	useMetricFormat,
} from "@ryot-app/plugin-ui-sdk";
import { formatReportingDateTime } from "@ryot-app/plugin-ui-sdk/charts";
import { DataTable, type DataTableColumn } from "@ryot-app/plugin-ui-sdk/table";
import { useMemo } from "react";

import { type FitnessText, useFitnessMessages } from "../messages";
import { analyticsWorkoutsQuery } from "./queries";
import type {
	AnalyticsDisplayPreferences,
	AnalyticsScope,
	WorkoutDrillRequest,
} from "./reporting-model";

const activeTimeUnit = durationUnit("seconds");

type DrillWorkout = {
	readonly id: string;
	readonly name: string;
	readonly startedAt: string;
	readonly activeDuration: null | number;
};

export function AnalyticsWorkoutDrill(props: {
	readonly compact: boolean;
	readonly onClose: () => void;
	readonly scope: AnalyticsScope;
	readonly request: WorkoutDrillRequest;
	readonly preferences: AnalyticsDisplayPreferences;
}) {
	const text = useFitnessMessages();
	const viewport = useRyotViewport();
	const result = useReportedPages(analyticsWorkoutsQuery, {
		...props.scope,
		selection: props.request.selection,
		...(props.request.filter === undefined ? {} : { filter: props.request.filter }),
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
	let countCaption: null | string = null;
	if (result.pages.length > 0) {
		countCaption = text(
			result.hasNextPage ? "client.analytics.drill.loaded-more" : "client.analytics.drill.loaded",
			{ count: items.length },
		);
	}
	let errorMessage = text("client.analytics.drill.load-failed");
	if (result.errorOperation === "append") {
		errorMessage = text("client.analytics.drill.append-failed");
	} else if (result.errorOperation === "refresh") {
		errorMessage = text("client.analytics.drill.refresh-failed");
	}
	const title = text("client.analytics.drill.title", {
		title: props.request.title,
		period: props.request.periodCaption,
	});

	return (
		<Dialog
			size="md"
			title={title}
			onClose={props.onClose}
			safeAreaBottom={viewport.safeAreaBottom}
			placement={props.compact ? "sheet" : "center"}
			closeLabel={text("client.analytics.drill.close", { title: props.request.title })}
		>
			<section
				className="flex min-w-0 flex-col gap-3"
				aria-label={text("client.analytics.drill.section-label", { title: props.request.title })}
			>
				<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
					{countCaption === null ? null : (
						<span className="text-label text-text-muted tabular-nums">{countCaption}</span>
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
					<StatusMessage tone="pending">{text("client.analytics.drill.loading")}</StatusMessage>
				) : null}
				{firstPage !== undefined ? (
					<>
						{result.operation === "refresh" ? (
							<StatusMessage tone="pending">
								{text("client.analytics.drill.refreshing")}
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
							<EmptyState title={text("client.analytics.drill.empty")} />
						) : (
							<WorkoutTable items={items} timeZone={firstPage.reporting.resolved.timeZone} />
						)}
						{result.hasNextPage && !result.isError ? (
							<LoadMoreButton
								variant="secondary"
								className="self-center"
								disabled={result.isFetching}
								onClick={result.fetchNextPage}
								isFetchingNextPage={result.isFetchingNextPage}
								label={text("client.analytics.drill.show-more")}
							/>
						) : null}
					</>
				) : null}
			</section>
		</Dialog>
	);
}

const headerClassName = "px-3 py-2.5 text-left font-medium text-text-muted";

const workoutColumns = (
	format: MetricFormat,
	formatters: Formatters,
	text: FitnessText,
	timeZone: TimeZone,
): DataTableColumn<DrillWorkout>[] => [
	{
		id: "workout",
		headerClassName,
		cellClassName: "px-3 py-2.5",
		header: text("client.workouts.column-workout"),
		cell: (workout) => (
			<PluginLink
				className="font-medium text-accent-text"
				to={{ kind: "entity", entityId: workout.id }}
			>
				{workout.name}
			</PluginLink>
		),
	},
	{
		id: "started",
		headerClassName,
		header: text("browse.field.started"),
		cellClassName: "px-3 py-2.5 text-text-muted",
		cell: (workout) => (
			<time dateTime={workout.startedAt}>
				{formatReportingDateTime(formatters, workout.startedAt, timeZone)}
			</time>
		),
	},
	{
		id: "active-duration",
		header: text("client.workout.active-duration"),
		cellClassName: "px-3 py-2.5 text-right text-text-muted",
		headerClassName: "px-3 py-2.5 text-right font-medium text-text-muted",
		cell: (workout) => format.formatMetric(workout.activeDuration, activeTimeUnit),
	},
];

function WorkoutTable(props: {
	readonly timeZone: TimeZone;
	readonly items: readonly DrillWorkout[];
}) {
	const text = useFitnessMessages();
	const format = useMetricFormat();
	const formatters = useFormatters();
	return (
		<Card padding="none" className="overflow-x-auto">
			<DataTable
				data={props.items}
				getRowId={(workout) => workout.id}
				rowClassName="border-t border-border"
				aria-label={text("client.analytics.drill.table-label")}
				className="w-full min-w-125 border-collapse text-sm tabular-nums"
				columns={workoutColumns(format, formatters, text, props.timeZone)}
			/>
		</Card>
	);
}
