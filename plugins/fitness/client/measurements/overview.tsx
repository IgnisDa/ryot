import { Select } from "@ryot-app/client-ui-sdk";
import { Sparkline, TimeSeriesChart } from "@ryot-app/client-ui-sdk/charts";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import clsx from "clsx";
import { useMemo } from "react";

import { cardClass, sectionHeadingClass } from "../exercise/styles";
import {
	CHART_GAP_MS,
	formatChange,
	formatDay,
	formatValue,
	isStale,
	rangePhrase,
	trendWindow,
	type MetricRow,
	type RangeKey,
} from "./model";

const unitSuffix = (unit: string | null) => (unit === null || unit === "" ? "" : ` (${unit})`);

function LastLogged(props: {
	readonly now: Date;
	readonly timeZone: string;
	readonly latestAt: string | null;
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

export function MetricTiles(props: {
	readonly now: Date;
	readonly range: RangeKey;
	readonly timeZone: string;
	readonly rows: readonly MetricRow[];
	readonly selectedId: string | null;
	readonly onSelect: (metricId: string) => void;
}) {
	const { now, rows, range, timeZone, onSelect, selectedId } = props;
	return (
		<div
			role="group"
			aria-label="Top metrics"
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
		</div>
	);
}

export function ChartCard(props: {
	readonly now: Date;
	readonly compact: boolean;
	readonly range: RangeKey;
	readonly timeZone: string;
	readonly selected: MetricRow;
	readonly compare: MetricRow | null;
	readonly others: readonly MetricRow[];
	readonly window: { readonly endAt: string; readonly startAt: string };
	readonly onCompareChange: (metricId: string) => void;
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
		<section className={cardClass} aria-label="Metric chart">
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
					{latestAt === null ? "" : ` The last one was on ${formatDay(latestAt, timeZone, true)}.`}
				</p>
			) : (
				<>
					<p className="text-[12.5px] text-text-muted">
						Line is the {trendWindow(selected.readings.length)}-reading average, dots are readings,
						and the shaded band spans low to high.
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
		</section>
	);
}
