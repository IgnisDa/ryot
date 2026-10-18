import { Card, Select } from "@ryot-app/plugin-ui-sdk";
import { Sparkline, TimeSeriesChart } from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { useMemo } from "react";

import { MEASUREMENT_PIN_LIMIT } from "../../shared/measurement-metric-operations";
import { sectionHeadingClass } from "../exercise/styles";
import {
	CHART_GAP_MS,
	formatChange,
	formatDay,
	formatValue,
	isStale,
	type MetricRow,
	type RangeKey,
	rangePhrase,
	trendWindow,
	unitSuffix,
} from "./model";

function LastLogged(props: {
	readonly now: Date;
	readonly timeZone: string;
	readonly latestAt: null | string;
}) {
	const { now, latestAt, timeZone } = props;
	if (latestAt === null) {
		return null;
	}
	if (isStale(latestAt, now)) {
		return (
			<span className="rounded-pill bg-surface-2 px-1.75 text-[11px] whitespace-nowrap text-text-subtle">
				last {formatDay(latestAt, timeZone, true)}
			</span>
		);
	}
	return <span className="whitespace-nowrap">{formatDay(latestAt, timeZone)}</span>;
}

const pinHint = (pinnedCount: number) => {
	if (pinnedCount === 0) {
		return `Star up to ${MEASUREMENT_PIN_LIMIT} metrics below to pin them here`;
	}
	const remaining = MEASUREMENT_PIN_LIMIT - pinnedCount;
	return remaining === 1
		? "Star one more metric below to pin it here"
		: `Star up to ${remaining} more metrics below to pin them here`;
};

export function MetricTiles(props: {
	readonly now: Date;
	readonly range: RangeKey;
	readonly timeZone: string;
	readonly selectedId: null | string;
	readonly rows: readonly MetricRow[];
	readonly onSelect: (metricId: string) => void;
}) {
	const { now, rows, range, timeZone, onSelect, selectedId } = props;
	return (
		<div
			role="group"
			aria-label="Pinned metrics"
			className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 font-ui"
		>
			{rows.map(({ trend, change, summary, readings }) => {
				const { id, name, unit, latestAt, latestValue } = summary;
				const delta =
					change === null
						? `${readings.length} reading${readings.length === 1 ? "" : "s"} in ${rangePhrase(range)}`
						: `${formatChange(change, unit)} over ${rangePhrase(range)}`;
				return (
					<button
						key={id}
						type="button"
						onClick={() => onSelect(id)}
						aria-pressed={id === selectedId}
						className={clsx(
							"grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-0.5 rounded-xl border bg-raised px-4 py-3.5 text-left",
							id === selectedId ? "border-accent" : "border-border",
						)}
					>
						<span className="col-span-2 flex justify-between gap-2 text-[13px] text-text-muted">
							<span className="truncate">{name}</span>
							<LastLogged now={now} latestAt={latestAt} timeZone={timeZone} />
						</span>
						<span className="text-[28px] leading-tight font-semibold text-text tabular-nums">
							{latestValue === null ? "—" : formatValue(latestValue, unit)}
						</span>
						<span className="row-span-2 col-start-2 row-start-2">
							<Sparkline tone="accent" points={trend} ariaLabel={`${name} trend`} />
						</span>
						<span className="text-[12.5px] text-text-muted tabular-nums">{delta}</span>
					</button>
				);
			})}
			{rows.length >= MEASUREMENT_PIN_LIMIT ? null : (
				<p className="flex min-h-27 items-center justify-center rounded-xl border border-dashed border-border px-4 py-3.5 text-center text-[13px] text-text-muted">
					{pinHint(rows.length)}
				</p>
			)}
		</div>
	);
}

export function ChartCard(props: {
	readonly now: Date;
	readonly range: RangeKey;
	readonly compact: boolean;
	readonly timeZone: string;
	readonly selected: MetricRow;
	readonly compare: null | MetricRow;
	readonly others: readonly MetricRow[];
	readonly onCompareChange: (metricId: string) => void;
	readonly window: { readonly endAt: string; readonly startAt: string };
}) {
	const { range, others, window, compare, compact, selected, timeZone, onCompareChange } = props;
	const { name, unit, latestAt } = selected.summary;
	const primary = useMemo(
		() => ({
			label: name,
			trend: selected.trend,
			readings: selected.readings,
			formatValue: (value: number) => formatValue(value, unit),
		}),
		[name, unit, selected.trend, selected.readings],
	);
	const compareSeries = useMemo(
		() =>
			compare === null
				? undefined
				: {
						trend: compare.trend,
						readings: compare.readings,
						label: compare.summary.name,
						formatValue: (value: number) => formatValue(value, compare.summary.unit),
					},
		[compare],
	);
	return (
		<section aria-label="Metric chart">
			<Card padding="lg" className="flex min-w-0 flex-col gap-3 font-ui">
				<header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
					<h2 className={sectionHeadingClass}>
						{name}
						{unitSuffix(unit)}
						{compare === null ? null : (
							<span className="font-ui text-[15px] font-medium text-text-muted">
								{" "}
								vs {compare.summary.name}
								{unitSuffix(compare.summary.unit)}
							</span>
						)}
					</h2>
					<div className="flex items-center gap-2 text-[13px] text-text-muted">
						<span>Compare with</span>
						<Select
							label="Compare with"
							onChange={onCompareChange}
							value={compare?.summary.id ?? ""}
							checkIcon={<AppIcon size={14} name="check" />}
							chevronIcon={<AppIcon size={14} name="chevron-down" />}
							choices={[
								{ value: "", label: "Nothing" },
								...others.map(({ summary }) => ({ value: summary.id, label: summary.name })),
							]}
						/>
					</div>
				</header>
				{selected.readings.length === 0 ? (
					<p className="py-16 text-center text-[14px] text-text-muted">
						No {name.toLowerCase()} readings in{" "}
						{range === "All" ? "your history" : `the last ${rangePhrase(range)}`}.
						{latestAt === null
							? ""
							: ` The last one was on ${formatDay(latestAt, timeZone, true)}.`}
					</p>
				) : (
					<>
						<p className="text-[12.5px] text-text-muted">
							Line is the {trendWindow(selected.readings.length)}-reading average, dots are
							readings, and the shaded band spans low to high.
							{compare === null ? "" : ` ${compare.summary.name} uses the right axis.`}
						</p>
						<TimeSeriesChart
							range={window}
							compact={compact}
							primary={primary}
							{...(compareSeries === undefined ? {} : { compare: compareSeries })}
							gapMs={CHART_GAP_MS}
							ariaLabel={`${name} over ${rangePhrase(range)}`}
						/>
					</>
				)}
			</Card>
		</section>
	);
}
