import type { ReportingCalendar, TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { useFormatters } from "@ryot-app/plugin-client-sdk/react";
import { Button, Card, SegmentedControl, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";

import type { WorkoutSummary } from "../../shared/workout-list-recipes";
import { useFitnessMessages } from "../messages";
import { ProcessingNote } from "../workout-processing";
import { buildHeatmap, buildSummaryTiles, type PeriodKey, periodOptions } from "./model";
import { toneClasses } from "./styles";

const levelClasses = [
	"bg-chart-seq-0",
	"bg-chart-seq-2",
	"bg-chart-seq-3",
	"bg-chart-seq-4",
	"bg-chart-seq-5",
] as const;

const headingClass = "text-[13px] font-medium tracking-wider text-text-subtle uppercase";

export function WorkoutSummarySection(props: {
	readonly now: Date;
	readonly isError: boolean;
	readonly imperial: boolean;
	readonly period: PeriodKey;
	readonly timeZone: TimeZone;
	readonly onRetry: () => void;
	readonly summary: undefined | WorkoutSummary;
	readonly weekStart: ReportingCalendar["weekStart"];
	readonly onPeriodChange: (period: PeriodKey) => void;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { period, summary } = props;
	let content = (
		<StatusMessage tone="pending">{text("client.workouts.summary.loading")}</StatusMessage>
	);
	if (summary === undefined && props.isError) {
		content = (
			<div className="flex flex-col items-start gap-3">
				<StatusMessage tone="error">{text("client.workouts.summary.failed")}</StatusMessage>
				<Button variant="secondary" onClick={props.onRetry}>
					{text("common.action.try-again")}
				</Button>
			</div>
		);
	}
	if (summary !== undefined) {
		content = (
			<div className="flex flex-wrap gap-4">
				<div className="grid min-w-0 flex-[999_1_560px] grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
					{buildSummaryTiles(formatters, text, summary, period, props.imperial).map((tile) => (
						<Card key={tile.label} className="flex min-w-0 flex-col gap-1.5">
							<span className="text-[13px] text-text-muted">{tile.label}</span>
							<span className="text-[28px] leading-tight font-semibold text-text tabular-nums">
								{tile.value}
							</span>
							<span className={clsx("text-[12.5px] tabular-nums", toneClasses[tile.tone])}>
								{tile.detail}
							</span>
						</Card>
					))}
				</div>
				<Heatmap
					now={props.now}
					summary={summary}
					calendar={{ timeZone: props.timeZone, weekStart: props.weekStart }}
				/>
			</div>
		);
	}
	return (
		<section
			className="flex min-w-0 flex-col gap-3 font-ui"
			aria-label={text("client.workouts.summary.label")}
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className={headingClass}>{text("client.workouts.period", { period })}</h2>
				<SegmentedControl
					value={period}
					optionClassName="px-3"
					onChange={props.onPeriodChange}
					label={text("client.workouts.summary.period-label")}
					options={periodOptions.map(({ key }) => ({
						value: key,
						label: text("client.workouts.period-short", { period: key }),
						content: text("client.workouts.period-short", { period: key }),
					}))}
				/>
			</div>
			<ProcessingNote />
			{content}
		</section>
	);
}

function Heatmap(props: {
	readonly now: Date;
	readonly summary: WorkoutSummary;
	readonly calendar: ReportingCalendar;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { weeks, streak } = buildHeatmap(formatters, props.summary, props.now, props.calendar);
	return (
		<Card className="flex min-w-0 flex-[1_1_400px] flex-col gap-3">
			<div className="flex items-baseline justify-between gap-2 text-[13px]">
				<span className="text-text-muted">
					{text("client.workouts.summary.consistency", { weeks: weeks.length })}
				</span>
				{streak > 1 ? (
					<span className="text-success">
						{text("client.workouts.summary.streak", { weeks: streak })}
					</span>
				) : null}
			</div>
			<div
				role="img"
				className="flex gap-0.75 overflow-x-auto"
				aria-label={text("client.workouts.summary.heatmap-label", { weeks: weeks.length })}
			>
				{weeks.map((week) => (
					<div key={week.key} className="flex flex-col gap-0.75">
						{week.cells.map((cell) => (
							<span
								key={cell.key}
								className={clsx(
									"size-2.75 rounded-[2px]",
									cell.level === null ? "bg-transparent" : levelClasses[cell.level],
								)}
							/>
						))}
					</div>
				))}
			</div>
			<div className="flex items-center justify-between gap-2 text-[11.5px] text-text-subtle">
				<span className="flex gap-3">
					{weeks.flatMap(({ key, month }) =>
						month === null ? [] : [<span key={key}>{month}</span>],
					)}
				</span>
				<span className="flex items-center gap-0.75">
					{text("client.workouts.summary.less")}
					{levelClasses.map((level) => (
						<span key={level} className={clsx("size-2.25 rounded-[2px]", level)} />
					))}
					{text("client.workouts.summary.more")}
				</span>
			</div>
		</Card>
	);
}
