import { SegmentedControl, StatusMessage } from "@ryot-app/client-ui-sdk";
import { Sparkline } from "@ryot-app/client-ui-sdk/charts";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import clsx from "clsx";

import { MEASUREMENT_PIN_LIMIT } from "../../shared/measurement-metric-operations";
import { sectionHeadingClass } from "../exercise/styles";
import {
	formatChange,
	formatDay,
	formatValue,
	rangePhrase,
	type MetricRow,
	type MetricSort,
	type RangeKey,
} from "./model";

const sortOptions = [
	{ value: "recent", label: "Recent", content: "Recent" },
	{ value: "changed", label: "Most changed", content: "Most changed" },
	{ value: "az", label: "A–Z", content: "A–Z" },
] as const satisfies readonly {
	readonly label: string;
	readonly value: MetricSort;
	readonly content: string;
}[];

const headerClass =
	"bg-surface-2 px-3 py-2 text-left text-[11.5px] font-medium tracking-wider whitespace-nowrap text-text-subtle uppercase";

export function MetricsTable(props: {
	readonly range: RangeKey;
	readonly sort: MetricSort;
	readonly timeZone: string;
	readonly rows: readonly MetricRow[];
	readonly pinPending: boolean;
	readonly selectedId: string | null;
	readonly pinError: string | undefined;
	readonly pinnedIds: ReadonlySet<string>;
	readonly onSelect: (metricId: string) => void;
	readonly onSortChange: (sort: MetricSort) => void;
	readonly onPinChange: (metricId: string, pinned: boolean) => void;
}) {
	const { rows, sort, range, timeZone, onSelect, selectedId, onSortChange } = props;
	const pinLimitReached = props.pinnedIds.size >= MEASUREMENT_PIN_LIMIT;
	return (
		<section aria-label="All metrics" className="flex min-w-0 flex-col gap-2.5 font-ui">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
				<h2 className={sectionHeadingClass}>All metrics</h2>
				<SegmentedControl
					value={sort}
					label="Sort metrics"
					options={sortOptions}
					optionClassName="px-3"
					onChange={onSortChange}
				/>
			</div>
			{props.pinError === undefined ? null : (
				<StatusMessage tone="error">{props.pinError}</StatusMessage>
			)}
			<div className="overflow-x-auto rounded-xl border border-border">
				<table className="w-full min-w-155 border-collapse text-[14px]">
					<thead>
						<tr>
							<th scope="col" className={clsx(headerClass, "w-9")}>
								<span className="sr-only">Pin</span>
							</th>
							<th scope="col" className={headerClass}>
								Metric
							</th>
							<th scope="col" className={clsx(headerClass, "text-right")}>
								Latest
							</th>
							<th scope="col" className={clsx(headerClass, "text-right")}>
								Change, {rangePhrase(range)}
							</th>
							<th scope="col" className={headerClass}>
								Trend
							</th>
							<th scope="col" className={clsx(headerClass, "text-right")}>
								Last logged
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
											aria-label={`Pin ${name}`}
											disabled={props.pinPending || pinBlocked}
											onClick={() => props.onPinChange(id, !pinned)}
											className={clsx(
												"inline-flex rounded-md p-1 disabled:opacity-50",
												pinned ? "text-accent" : "text-border-strong",
											)}
											title={
												pinBlocked
													? `Only ${MEASUREMENT_PIN_LIMIT} metrics can be pinned. Unpin one first.`
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
											{rangeCount} reading{rangeCount === 1 ? "" : "s"} in {rangePhrase(range)}
										</span>
									</td>
									<td className="px-3 py-2 text-right tabular-nums">
										{latestValue === null ? "—" : formatValue(latestValue, unit)}
									</td>
									<td className="px-3 py-2 text-right text-text-muted tabular-nums">
										{change === null ? "—" : formatChange(change, unit)}
									</td>
									<td className="px-3 py-2">
										<Sparkline
											points={trend}
											ariaLabel={`${name} trend`}
											tone={id === selectedId ? "accent" : "muted"}
										/>
									</td>
									<td className="px-3 py-2 text-right text-text-subtle tabular-nums">
										{latestAt === null ? "—" : formatDay(latestAt, timeZone, true)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</section>
	);
}
