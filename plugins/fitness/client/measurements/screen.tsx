import { usePageContext, useRyotViewport } from "@ryot-app/client-sdk/plugin";
import { useRyotMutation, useRyotQuery, type RyotQueryResult } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, SegmentedControl, StatusMessage } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import clsx from "clsx";
import { useMemo, useRef, useState, type RefObject } from "react";

import type { MeasurementSeries, MeasurementSummary } from "../../shared/measurement-recipes";
import { AddMetricDialog } from "./add-metric";
import { MetricsTable } from "./metrics-table";
import {
	buildMetricRows,
	rangeOptions,
	rangeStartAt,
	selectPinnedMetrics,
	seriesWindow,
	sortMetricRows,
	type MetricSort,
	type RangeKey,
} from "./model";
import { logReadingsMutation, pinMetricMutation, readingFailureMessage } from "./mutations";
import { ChartCard, MetricTiles } from "./overview";
import { seriesQuery, summaryQuery } from "./queries";
import { MeasurementDialog } from "./reading-composer";
import { ReadingLog } from "./reading-log";

function LogMeasurementDialog(props: {
	readonly onClose: () => void;
	readonly metrics: readonly MeasurementSummary[];
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const { metrics } = props;
	const log = useRyotMutation(logReadingsMutation);
	const [initial] = useState(() => {
		const pinned = selectPinnedMetrics(metrics);
		return {
			comment: null,
			occurredAt: new Date().toISOString(),
			values: (pinned.length === 0 ? metrics.slice(0, 1) : pinned).map(({ id }) => ({
				value: null,
				metricId: id,
			})),
		};
	});
	return (
		<MeasurementDialog
			initial={initial}
			metrics={metrics}
			submitLabel="Save"
			onChange={log.reset}
			pendingLabel="Saving…"
			label="Log measurement"
			onClose={props.onClose}
			pending={log.isPending}
			triggerRef={props.triggerRef}
			errorMessage={readingFailureMessage(log.error, "log")}
			onSubmit={(readings) => log.mutate({ readings, onSuccess: props.onClose })}
		/>
	);
}

export function MeasurementsView(props: {
	readonly now: Date;
	readonly compact: boolean;
	readonly range: RangeKey;
	readonly timeZone: string;
	readonly series: readonly MeasurementSeries[];
	readonly summaries: readonly MeasurementSummary[];
}) {
	const { now, range, series, compact, timeZone, summaries } = props;
	const [sort, setSort] = useState<MetricSort>("recent");
	const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
	const [compareChoice, setCompareChoice] = useState("");
	const pin = useRyotMutation(pinMetricMutation);
	const rows = useMemo(() => buildMetricRows(summaries, series), [summaries, series]);
	const tiles = useMemo(
		() =>
			selectPinnedMetrics(summaries).flatMap(({ id }) =>
				rows.filter(({ summary }) => summary.id === id),
			),
		[summaries, rows],
	);
	const pinnedIds = useMemo(() => new Set(tiles.map(({ summary }) => summary.id)), [tiles]);
	const sortedRows = useMemo(() => sortMetricRows(rows, sort), [rows, sort]);
	const window = useMemo(() => seriesWindow(range, now, summaries), [range, now, summaries]);
	const selected = rows.find(({ summary }) => summary.id === selectedChoice) ?? tiles[0] ?? rows[0];
	const compare =
		rows.find(
			({ summary }) => summary.id === compareChoice && summary.id !== selected?.summary.id,
		) ?? null;
	const select = (metricId: string) => {
		setSelectedChoice(metricId);
		if (metricId === compareChoice) {
			setCompareChoice("");
		}
	};
	return (
		<div className="flex min-w-0 flex-col gap-6">
			<MetricTiles
				now={now}
				rows={tiles}
				range={range}
				onSelect={select}
				timeZone={timeZone}
				selectedId={selected?.summary.id ?? null}
			/>
			{selected === undefined ? null : (
				<ChartCard
					now={now}
					range={range}
					window={window}
					compare={compare}
					compact={compact}
					selected={selected}
					timeZone={timeZone}
					onCompareChange={setCompareChoice}
					others={rows.filter(({ summary }) => summary.id !== selected.summary.id)}
				/>
			)}
			<MetricsTable
				sort={sort}
				range={range}
				rows={sortedRows}
				onSelect={select}
				timeZone={timeZone}
				pinnedIds={pinnedIds}
				onSortChange={setSort}
				pinPending={pin.isPending}
				selectedId={selected?.summary.id ?? null}
				onPinChange={(metricId, pinned) => pin.mutate({ pinned, metricId })}
				pinError={pin.error === null ? undefined : "The pin couldn't be changed. Try again."}
			/>
			<ReadingLog
				key={range}
				range={range}
				timeZone={timeZone}
				startAt={rangeStartAt(range, now)}
				metrics={rows.map(({ summary }) => summary)}
				columns={tiles.map(({ summary }) => summary)}
			/>
		</div>
	);
}

function MeasurementsContent(props: {
	readonly now: Date;
	readonly compact: boolean;
	readonly range: RangeKey;
	readonly timeZone: string;
	readonly summaries: readonly MeasurementSummary[];
}) {
	const { now, range, compact, timeZone, summaries } = props;
	const window = useMemo(() => seriesWindow(range, now, summaries), [range, now, summaries]);
	const metricIds = useMemo(() => summaries.map(({ id }) => id), [summaries]);
	const result = useRyotQuery(seriesQuery, { ...window, metricIds });
	if (result.data !== undefined) {
		return (
			<MeasurementsView
				now={now}
				range={range}
				compact={compact}
				timeZone={timeZone}
				series={result.data}
				summaries={summaries}
			/>
		);
	}
	if (result.isError) {
		return (
			<div className="flex flex-col items-start gap-3 font-ui">
				<StatusMessage tone="error">Your measurement trends couldn't be loaded.</StatusMessage>
				<Button variant="secondary" onClick={result.refetch}>
					Try again
				</Button>
			</div>
		);
	}
	return (
		<StatusMessage tone="pending" className="font-ui">
			Loading trends…
		</StatusMessage>
	);
}

function MeasurementsBody(props: {
	readonly now: Date;
	readonly compact: boolean;
	readonly range: RangeKey;
	readonly timeZone: string;
	readonly result: RyotQueryResult<readonly MeasurementSummary[]>;
}) {
	const { result } = props;
	if (result.data === undefined) {
		return result.isError ? (
			<div className="flex flex-col items-start gap-3 font-ui">
				<StatusMessage tone="error">Your measurements couldn't be loaded.</StatusMessage>
				<Button variant="secondary" onClick={result.refetch}>
					Try again
				</Button>
			</div>
		) : (
			<StatusMessage tone="pending" className="font-ui">
				Loading measurements…
			</StatusMessage>
		);
	}
	if (result.data.length === 0) {
		return (
			<div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border p-6 font-ui">
				<h2 className="font-display text-[22px] font-semibold text-text">No measurements yet</h2>
				<p className="text-[14px] text-text-muted">
					Add a metric to track, or import your history from OpenScale, to get started.
				</p>
			</div>
		);
	}
	return <MeasurementsContent {...props} summaries={result.data} />;
}

export default function MeasurementsPage() {
	const { view } = usePageContext();
	const { compact } = useRyotViewport();
	const [now] = useState(() => new Date());
	const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
	const [range, setRange] = useState<RangeKey>("1Y");
	const [addingMetric, setAddingMetric] = useState(false);
	const [logging, setLogging] = useState(false);
	const addMetricTrigger = useRef<HTMLButtonElement>(null);
	const logTrigger = useRef<HTMLButtonElement>(null);
	const result = useRyotQuery(summaryQuery, { rangeStart: rangeStartAt(range, now) });
	const controls = (
		<div className={clsx("flex flex-wrap items-center gap-2.5", compact && "pb-4")}>
			<SegmentedControl
				value={range}
				label="Time range"
				onChange={setRange}
				optionClassName="px-3"
				options={rangeOptions.map(({ key }) => ({ value: key, label: key, content: key }))}
			/>
			<Button
				ref={logTrigger}
				onClick={() => setLogging(true)}
				className="min-h-9 px-3.5 py-1.5"
				disabled={result.data === undefined || result.data.length === 0}
			>
				Log measurement
			</Button>
			<Button
				variant="secondary"
				ref={addMetricTrigger}
				className="min-h-9 px-3 py-1.5"
				onClick={() => setAddingMetric(true)}
				disabled={result.data === undefined || result.isFetching || result.isError}
			>
				Add metric
			</Button>
		</div>
	);
	return (
		<PluginScreenFrame
			title={view?.name ?? "Measurements"}
			actions={compact ? undefined : controls}
			titleIcon={
				<AppIcon size={20} name={view?.icon ?? "ruler"} className="shrink-0 text-text-muted" />
			}
		>
			{compact ? controls : null}
			<MeasurementsBody
				now={now}
				range={range}
				result={result}
				compact={compact}
				timeZone={timeZone}
			/>
			{addingMetric && result.data !== undefined ? (
				<AddMetricDialog
					metrics={result.data}
					triggerRef={addMetricTrigger}
					onClose={() => setAddingMetric(false)}
				/>
			) : null}
			{logging && result.data !== undefined ? (
				<LogMeasurementDialog
					metrics={result.data}
					triggerRef={logTrigger}
					onClose={() => setLogging(false)}
				/>
			) : null}
		</PluginScreenFrame>
	);
}
