import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import { usePageContext, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import {
	type RyotQueryResult,
	usePageRefresh,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, EmptyState, SegmentedControl, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { useMemo, useRef, useState } from "react";

import type { MeasurementSeries, MeasurementSummary } from "../../shared/measurement-recipes";
import { MeasurementDialogs, type MeasurementDialogState } from "./measurement-logger";
import { MetricsTable } from "./metrics-table";
import {
	buildMetricRows,
	type MetricSort,
	type RangeKey,
	rangeOptions,
	selectPinnedMetrics,
	seriesWindow,
	sortMetricRows,
} from "./model";
import { pinMetricMutation } from "./mutations";
import { ChartCard, MetricTiles } from "./overview";
import { seriesQuery, summaryQuery } from "./queries";
import { ReadingLog } from "./reading-log";

export default function MeasurementsPage() {
	const { view } = usePageContext();
	const { compact } = useRyotViewport();
	const [now, setNow] = useState(() => new Date());
	usePageRefresh(() =>
		DateTime.now.pipe(
			Effect.flatMap((currentTime) => Effect.sync(() => setNow(DateTime.toDate(currentTime)))),
		),
	);
	const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
	const [range, setRange] = useState<RangeKey>("1Y");
	const [dialog, setDialog] = useState<MeasurementDialogState>();
	const addMetricTrigger = useRef<HTMLButtonElement>(null);
	const logTrigger = useRef<HTMLButtonElement>(null);
	const result = useRyotQuery(summaryQuery, { range });
	const openDialog = (kind: MeasurementDialogState["kind"]) => {
		if (result.data !== undefined) {
			setDialog({ kind, metrics: result.data });
		}
	};
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
				className="min-h-9 px-3.5 py-1.5"
				onClick={() => openDialog("log")}
				disabled={result.data === undefined || result.data.length === 0}
			>
				Log measurement
			</Button>
			<Button
				variant="secondary"
				ref={addMetricTrigger}
				className="min-h-9 px-3 py-1.5"
				onClick={() => openDialog("add-metric")}
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
			<MeasurementDialogs
				dialog={dialog}
				onClose={() => setDialog(undefined)}
				trigger={dialog?.kind === "log" ? logTrigger : addMetricTrigger}
			/>
		</PluginScreenFrame>
	);
}

export function MeasurementsView(props: {
	readonly now: Date;
	readonly range: RangeKey;
	readonly compact: boolean;
	readonly timeZone: string;
	readonly series: readonly MeasurementSeries[];
	readonly summaries: readonly MeasurementSummary[];
}) {
	const { now, range, series, compact, timeZone, summaries } = props;
	const [sort, setSort] = useState<MetricSort>("recent");
	const [selectedChoice, setSelectedChoice] = useState<null | string>(null);
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
				metrics={rows.map(({ summary }) => summary)}
				columns={tiles.map(({ summary }) => summary)}
			/>
		</div>
	);
}

function MeasurementsBody(props: {
	readonly now: Date;
	readonly range: RangeKey;
	readonly compact: boolean;
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
			<EmptyState
				className="font-ui"
				title="No measurements yet"
				description="Add a metric to track, or import your history from OpenScale, to get started."
			/>
		);
	}
	return <MeasurementsContent {...props} summaries={result.data} />;
}

function MeasurementsContent(props: {
	readonly now: Date;
	readonly range: RangeKey;
	readonly compact: boolean;
	readonly timeZone: string;
	readonly summaries: readonly MeasurementSummary[];
}) {
	const { now, range, compact, timeZone, summaries } = props;
	const metricIds = useMemo(() => summaries.map(({ id }) => id), [summaries]);
	const result = useRyotQuery(seriesQuery, {
		range,
		metricIds,
		firstReadings: summaries.map(({ firstAt }) => ({ firstAt })),
	});
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
