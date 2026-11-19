import type { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { useDisplayText, useFormatters } from "@ryot-app/plugin-client-sdk/react";
import { Card, Select } from "@ryot-app/plugin-ui-sdk";
import { Sparkline, TimeSeriesChart } from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { useMemo } from "react";

import { MEASUREMENT_PIN_LIMIT } from "../../shared/measurement-metric-operations";
import type { MetricRow } from "../../shared/measurement-metrics";
import { sectionHeadingClass } from "../exercise/styles";
import { type FitnessText, useFitnessMessages } from "../messages";
import {
	formatChange,
	formatDay,
	formatValue,
	isStale,
	nameWithUnit,
	type RangeKey,
} from "./model";

function LastLogged(props: {
	readonly now: Date;
	readonly timeZone: TimeZone;
	readonly latestAt: null | string;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { now, latestAt, timeZone } = props;
	if (latestAt === null) {
		return null;
	}
	if (isStale(latestAt, now)) {
		return (
			<span className="rounded-pill bg-surface-2 px-1.75 text-[11px] whitespace-nowrap text-text-subtle">
				{text("client.measurements.last-date", {
					date: formatDay(formatters, latestAt, timeZone, true),
				})}
			</span>
		);
	}
	return <span className="whitespace-nowrap">{formatDay(formatters, latestAt, timeZone)}</span>;
}

const pinHint = (text: FitnessText, pinnedCount: number) => {
	if (pinnedCount === 0) {
		return text("client.measurements.pin-hint-none", { limit: MEASUREMENT_PIN_LIMIT });
	}
	const remaining = MEASUREMENT_PIN_LIMIT - pinnedCount;
	return remaining === 1
		? text("client.measurements.pin-hint-one")
		: text("client.measurements.pin-hint-more", { remaining });
};

export function MetricTiles(props: {
	readonly now: Date;
	readonly range: RangeKey;
	readonly timeZone: TimeZone;
	readonly selectedId: null | string;
	readonly rows: readonly MetricRow[];
	readonly onSelect: (metricId: string) => void;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { now, rows, range, timeZone, onSelect, selectedId } = props;
	return (
		<div
			role="group"
			aria-label={text("client.measurements.pinned-metrics")}
			className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 font-ui"
		>
			{rows.map(({ trend, change, summary }) => {
				const { id, name, unit, latestAt, rangeCount, latestValue } = summary;
				const delta =
					change === null
						? text("client.measurements.range-readings", { range, count: rangeCount })
						: text("client.measurements.range-change", {
								range,
								change: formatChange(formatters, text, change, unit),
							});
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
							{latestValue === null ? "—" : formatValue(formatters, text, latestValue, unit)}
						</span>
						<span className="row-span-2 col-start-2 row-start-2">
							<Sparkline
								tone="accent"
								points={trend}
								ariaLabel={text("client.measurements.trend-label", { name })}
							/>
						</span>
						<span className="text-[12.5px] text-text-muted tabular-nums">{delta}</span>
					</button>
				);
			})}
			{rows.length >= MEASUREMENT_PIN_LIMIT ? null : (
				<p className="flex min-h-27 items-center justify-center rounded-xl border border-dashed border-border px-4 py-3.5 text-center text-[13px] text-text-muted">
					{pinHint(text, rows.length)}
				</p>
			)}
		</div>
	);
}

export function ChartCard(props: {
	readonly now: Date;
	readonly range: RangeKey;
	readonly compact: boolean;
	readonly timeZone: TimeZone;
	readonly selected: MetricRow;
	readonly compare: null | MetricRow;
	readonly others: readonly MetricRow[];
	readonly onCompareChange: (metricId: string) => void;
	readonly window: { readonly endAt: string; readonly startAt: string };
}) {
	const displayText = useDisplayText();
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { range, others, window, compare, compact, selected, timeZone, onCompareChange } = props;
	const { name, unit, latestAt } = selected.summary;
	const primary = useMemo(
		() => ({
			trend: selected.trend,
			readings: selected.averages,
			label: text("client.measurements.grouped-average", { name }),
			formatValue: (value: number) => formatValue(formatters, text, value, unit),
		}),
		[formatters, text, name, unit, selected.trend, selected.averages],
	);
	const compareSeries = useMemo(
		() =>
			compare === null
				? undefined
				: {
						trend: compare.trend,
						readings: compare.averages,
						label: text("client.measurements.grouped-average", { name: compare.summary.name }),
						formatValue: (value: number) =>
							formatValue(formatters, text, value, compare.summary.unit),
					},
		[compare, formatters, text],
	);
	return (
		<section aria-label={text("client.measurements.chart-label")}>
			<Card padding="lg" className="flex min-w-0 flex-col gap-3 font-ui">
				<header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
					<h2 className={sectionHeadingClass}>
						{nameWithUnit(text, name, unit)}
						{compare === null ? null : (
							<span className="font-ui text-[15px] font-medium text-text-muted">
								{" "}
								{text("client.measurements.versus", {
									name: nameWithUnit(text, compare.summary.name, compare.summary.unit),
								})}
							</span>
						)}
					</h2>
					<div className="flex items-center gap-2 text-[13px] text-text-muted">
						<span>{text("client.measurements.compare-with")}</span>
						<Select
							onChange={onCompareChange}
							value={compare?.summary.id ?? ""}
							checkIcon={<AppIcon size={14} name="check" />}
							label={text("client.measurements.compare-with")}
							chevronIcon={<AppIcon size={14} name="chevron-down" />}
							choices={[
								{ value: "", label: text("client.measurements.compare-nothing") },
								...others.map(({ summary }) => ({
									value: summary.id,
									label: displayText(summary.name),
								})),
							]}
						/>
					</div>
				</header>
				{selected.averages.length === 0 ? (
					<p className="py-16 text-center text-[14px] text-text-muted">
						{text("client.measurements.chart-empty", { name, range })}
						{latestAt === null ? null : (
							<>
								{" "}
								{text("client.measurements.chart-empty-last", {
									date: formatDay(formatters, latestAt, timeZone, true),
								})}
							</>
						)}
					</p>
				) : (
					<>
						<p className="text-[12.5px] text-text-muted">
							{text("client.measurements.chart-note")}
							{compare === null ? null : (
								<> {text("client.measurements.chart-right-axis", { name: compare.summary.name })}</>
							)}
						</p>
						<TimeSeriesChart
							range={window}
							compact={compact}
							primary={primary}
							{...(compareSeries === undefined ? {} : { compare: compareSeries })}
							gapMs={Number.POSITIVE_INFINITY}
							ariaLabel={text("client.measurements.chart-over", { name, range })}
						/>
					</>
				)}
			</Card>
		</section>
	);
}
