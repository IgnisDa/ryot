import type { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import type { Text } from "@ryot-app/plugin-client-sdk/react";
import { useFormatters } from "@ryot-app/plugin-client-sdk/react";
import { Card, SegmentedControl, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { Sparkline } from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";

import { MEASUREMENT_PIN_LIMIT } from "../../shared/measurement-metric-operations";
import type { MetricRow, MetricSort } from "../../shared/measurement-metrics";
import { sectionHeadingClass } from "../exercise/styles";
import { type FitnessText, useFitnessMessages } from "../messages";
import { formatChange, formatDay, formatValue, type RangeKey } from "./model";
import { tableHeaderClass } from "./styles";

const sortOptions = (text: FitnessText) =>
	[
		{
			value: "recent",
			label: text("client.measurements.sort-recent"),
			content: text("client.measurements.sort-recent"),
		},
		{
			value: "changed",
			label: text("client.measurements.sort-changed"),
			content: text("client.measurements.sort-changed"),
		},
		{
			value: "az",
			label: text("client.measurements.sort-az"),
			content: text("client.measurements.sort-az"),
		},
	] as const satisfies readonly {
		readonly label: Text;
		readonly content: string;
		readonly value: MetricSort;
	}[];

export function MetricsTable(props: {
	readonly range: RangeKey;
	readonly sort: MetricSort;
	readonly timeZone: TimeZone;
	readonly pinPending: boolean;
	readonly selectedId: null | string;
	readonly rows: readonly MetricRow[];
	readonly pinError: string | undefined;
	readonly pinnedIds: ReadonlySet<string>;
	readonly onSelect: (metricId: string) => void;
	readonly onSortChange: (sort: MetricSort) => void;
	readonly onPinChange: (metricId: string, pinned: boolean) => void;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { rows, sort, range, timeZone, onSelect, selectedId, onSortChange } = props;
	const pinLimitReached = props.pinnedIds.size >= MEASUREMENT_PIN_LIMIT;
	return (
		<section
			className="flex min-w-0 flex-col gap-2.5 font-ui"
			aria-label={text("client.measurements.all-metrics")}
		>
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
				<h2 className={sectionHeadingClass}>{text("client.measurements.all-metrics")}</h2>
				<SegmentedControl
					value={sort}
					optionClassName="px-3"
					onChange={onSortChange}
					options={sortOptions(text)}
					label={text("client.measurements.sort-label")}
				/>
			</div>
			{props.pinError === undefined ? null : (
				<StatusMessage tone="error">{props.pinError}</StatusMessage>
			)}
			<Card padding="none" className="overflow-x-auto">
				<table className="w-full min-w-155 border-collapse text-[14px]">
					<thead>
						<tr>
							<th scope="col" className={clsx(tableHeaderClass, "w-9")}>
								<span className="sr-only">{text("client.measurements.column-pin")}</span>
							</th>
							<th scope="col" className={tableHeaderClass}>
								{text("client.measurements.column-metric")}
							</th>
							<th scope="col" className={clsx(tableHeaderClass, "text-right")}>
								{text("client.measurements.column-latest")}
							</th>
							<th scope="col" className={clsx(tableHeaderClass, "text-right")}>
								{text("client.measurements.column-change", { range })}
							</th>
							<th scope="col" className={tableHeaderClass}>
								{text("client.measurements.column-trend")}
							</th>
							<th scope="col" className={clsx(tableHeaderClass, "text-right")}>
								{text("client.measurements.column-last-logged")}
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map(({ trend, change, summary }) => {
							const { id, name, unit, latestAt, rangeCount, latestValue } = summary;
							const pinned = props.pinnedIds.has(id);
							const pinBlocked = !pinned && pinLimitReached;
							return (
								<tr
									key={id}
									className={clsx("border-t border-border", id === selectedId && "bg-accent-soft")}
								>
									<td className="px-3 py-2">
										<button
											type="button"
											aria-pressed={pinned}
											disabled={props.pinPending || pinBlocked}
											onClick={() => props.onPinChange(id, !pinned)}
											aria-label={text("client.measurements.pin-label", { name })}
											className={clsx(
												"inline-flex rounded-md p-1 disabled:opacity-50",
												pinned ? "text-accent" : "text-border-strong",
											)}
											title={
												pinBlocked
													? text("client.measurements.pin-limit", { limit: MEASUREMENT_PIN_LIMIT })
													: undefined
											}
										>
											<AppIcon size={16} name="star" className={clsx(pinned && "fill-current")} />
										</button>
									</td>
									<td className="px-3 py-2">
										<button
											type="button"
											onClick={() => onSelect(id)}
											aria-pressed={id === selectedId}
											className="block text-left font-medium text-text"
										>
											{name}
										</button>
										<span className="block text-[12px] text-text-subtle tabular-nums">
											{text("client.measurements.range-readings", { range, count: rangeCount })}
										</span>
									</td>
									<td className="px-3 py-2 text-right tabular-nums">
										{latestValue === null ? "—" : formatValue(formatters, text, latestValue, unit)}
									</td>
									<td className="px-3 py-2 text-right text-text-muted tabular-nums">
										{change === null ? "—" : formatChange(formatters, text, change, unit)}
									</td>
									<td className="px-3 py-2">
										<Sparkline
											points={trend}
											tone={id === selectedId ? "accent" : "muted"}
											ariaLabel={text("client.measurements.trend-label", { name })}
										/>
									</td>
									<td className="px-3 py-2 text-right text-text-subtle tabular-nums">
										{latestAt === null ? "—" : formatDay(formatters, latestAt, timeZone, true)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</Card>
		</section>
	);
}
