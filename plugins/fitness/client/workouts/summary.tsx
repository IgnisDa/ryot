import { Button, Card, SegmentedControl, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";

import type { WorkoutSummary } from "../../shared/workout-list-recipes";
import { buildHeatmap, buildSummaryTiles, periodOptions, type PeriodKey } from "./model";
import { toneClasses } from "./styles";

const levelClasses = [
	"bg-chart-seq-0",
	"bg-chart-seq-2",
	"bg-chart-seq-3",
	"bg-chart-seq-4",
	"bg-chart-seq-5",
] as const;

const headingClass = "text-[13px] font-medium tracking-wider text-text-subtle uppercase";

function Heatmap(props: {
	readonly now: Date;
	readonly timeZone: string;
	readonly summary: WorkoutSummary;
}) {
	const { weeks, streak } = buildHeatmap(props.summary, props.now, props.timeZone);
	return (
		<Card className="flex min-w-0 flex-[1_1_400px] flex-col gap-3">
			<div className="flex items-baseline justify-between gap-2 text-[13px]">
				<span className="text-text-muted">Consistency · {weeks.length} weeks</span>
				{streak > 1 ? <span className="text-success">{streak}-week streak</span> : null}
			</div>
			<div
				role="img"
				className="flex gap-0.75 overflow-x-auto"
				aria-label={`Training days over the last ${weeks.length} weeks`}
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
					Less
					{levelClasses.map((level) => (
						<span key={level} className={clsx("size-2.25 rounded-[2px]", level)} />
					))}
					More volume
				</span>
			</div>
		</Card>
	);
}

export function WorkoutSummarySection(props: {
	readonly now: Date;
	readonly imperial: boolean;
	readonly period: PeriodKey;
	readonly timeZone: string;
	readonly isError: boolean;
	readonly onRetry: () => void;
	readonly summary: WorkoutSummary | undefined;
	readonly onPeriodChange: (period: PeriodKey) => void;
}) {
	const { period, summary } = props;
	const label = periodOptions.find(({ key }) => key === period)?.label ?? "";
	let content = <StatusMessage tone="pending">Loading your training summary…</StatusMessage>;
	if (summary === undefined && props.isError) {
		content = (
			<div className="flex flex-col items-start gap-3">
				<StatusMessage tone="error">Your training summary couldn&apos;t be loaded.</StatusMessage>
				<Button variant="secondary" onClick={props.onRetry}>
					Try again
				</Button>
			</div>
		);
	}
	if (summary !== undefined) {
		content = (
			<div className="flex flex-wrap gap-4">
				<div className="grid min-w-0 flex-[999_1_560px] grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
					{buildSummaryTiles(summary, period, props.imperial).map((tile) => (
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
				<Heatmap now={props.now} summary={summary} timeZone={props.timeZone} />
			</div>
		);
	}
	return (
		<section aria-label="Summary" className="flex min-w-0 flex-col gap-3 font-ui">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className={headingClass}>{label}</h2>
				<SegmentedControl
					value={period}
					label="Summary period"
					optionClassName="px-3"
					onChange={props.onPeriodChange}
					options={periodOptions.map(({ key }) => ({ value: key, label: key, content: key }))}
				/>
			</div>
			{content}
		</section>
	);
}
