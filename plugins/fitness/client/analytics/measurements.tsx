import {
	formatExactValue,
	periodCaption,
	type Reported,
	type TimeZone,
	useRyotViewport as usePluginViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	paginationItems,
	reportingPageParam,
	useRyotInfiniteQuery,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Checkbox,
	Dialog,
	EmptyState,
	LoadMoreButton,
	Notice,
	QueryStatus,
	Skeleton,
} from "@ryot-app/plugin-ui-sdk";
import { PeriodTrendChart } from "@ryot-app/plugin-ui-sdk/charts";
import { type RefObject, useCallback, useMemo, useRef, useState } from "react";

import {
	analyticsMeasurementMetricsQuery,
	analyticsPageInput,
	measurementReadingsQuery,
	measurementTrendQuery,
} from "./queries";
import {
	type AnalyticsScope,
	type MeasurementMetric,
	type MeasurementReading,
	type MeasurementTrend,
	measurementTrendModel,
} from "./reporting-model";

type SelectedMetric = Pick<MeasurementMetric, "id" | "name" | "unit">;

export function AnalyticsMeasurements(props: {
	readonly compact: boolean;
	readonly scope: AnalyticsScope;
}) {
	const { scope, compact } = props;
	const [metric, setMetric] = useState<null | SelectedMetric>(null);
	const [pickerOpen, setPickerOpen] = useState(false);
	const metricButtonRef = useRef<HTMLButtonElement>(null);
	return (
		<div className="flex min-w-0 flex-col gap-5">
			<section aria-label="Measurement metric" className="flex flex-col gap-2">
				<h2 className="text-heading font-semibold text-text">Measurement metric</h2>
				<Button
					variant="secondary"
					ref={metricButtonRef}
					className="max-w-full self-start"
					onClick={() => setPickerOpen(true)}
				>
					<span className="min-w-0 truncate">{metric?.name ?? "Choose a metric"}</span>
				</Button>
				{metric === null ? (
					<p className="text-sm text-text-muted">Choose a metric to view its trend and readings.</p>
				) : (
					<SelectedMeasurement scope={scope} metric={metric} compact={compact} />
				)}
			</section>
			{pickerOpen ? (
				<MetricPicker
					scope={scope}
					compact={compact}
					metricButtonRef={metricButtonRef}
					onClose={() => setPickerOpen(false)}
					onSelect={(selected) => {
						setMetric(selected);
						setPickerOpen(false);
					}}
				/>
			) : null}
		</div>
	);
}

function bucketDetail(bucket: {
	readonly detail: string;
	readonly source: null | MeasurementTrend["points"][number];
}) {
	return bucket.source === null
		? bucket.detail
		: `${bucket.detail}; source average ${formatExactValue(bucket.source.value, bucket.source.unit)}`;
}

function formatReadingTime(occurredAt: string, timeZone: TimeZone) {
	return new Intl.DateTimeFormat(undefined, {
		timeZone,
		day: "numeric",
		month: "short",
		hour: "numeric",
		year: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	}).format(new Date(occurredAt));
}

function useSelectedReadings(scope: AnalyticsScope, metricId: string) {
	return useRyotInfiniteQuery(
		measurementReadingsQuery,
		{ metricId, reference: scope.owner, timeZone: scope.timeZone, selection: scope.selection },
		{
			initialPageParam: null,
			getPageInput: analyticsPageInput,
			getNextPageParam: reportingPageParam,
		},
	);
}

function SelectedMeasurement(props: {
	readonly compact: boolean;
	readonly scope: AnalyticsScope;
	readonly metric: SelectedMetric;
}) {
	const [smooth, setSmooth] = useState(false);
	const readingsQuery = useSelectedReadings(props.scope, props.metric.id);
	const readings = useMemo(
		() =>
			paginationItems(
				readingsQuery.pages,
				(page) => page.items,
				({ id }) => id,
			),
		[readingsQuery.pages],
	);
	return (
		<div className="flex min-w-0 flex-col gap-5">
			<MeasurementTrendPanel
				smooth={smooth}
				scope={props.scope}
				metric={props.metric}
				compact={props.compact}
				onSmoothChange={setSmooth}
			/>
			<ReadingsTable readings={readings} query={readingsQuery} timeZone={props.scope.timeZone} />
		</div>
	);
}

function PreviousMeasurementTrend(props: {
	readonly smooth: boolean;
	readonly compact: boolean;
	readonly scope: AnalyticsScope;
	readonly metric: SelectedMetric;
	readonly current: Reported<MeasurementTrend>;
}) {
	const previous = useRyotQuery(measurementTrendQuery, {
		period: "previous",
		metricId: props.metric.id,
		reference: props.scope.owner,
		timeZone: props.scope.timeZone,
		selection: props.scope.selection,
	});
	return (
		<div className="flex min-w-0 flex-col gap-3">
			<QueryStatus query={previous} onRetry={previous.refetch} label="previous-period comparison" />
			<TrendChart
				metric={props.metric}
				smooth={props.smooth}
				compact={props.compact}
				current={props.current}
				previous={previous.data}
				timeZone={props.scope.timeZone}
			/>
		</div>
	);
}

function TrendChart(props: {
	readonly smooth: boolean;
	readonly compact: boolean;
	readonly timeZone: TimeZone;
	readonly metric: SelectedMetric;
	readonly current: Reported<MeasurementTrend>;
	readonly previous?: undefined | Reported<MeasurementTrend>;
}) {
	const { smooth, current, previous, timeZone } = props;
	const model = useMemo(
		() => measurementTrendModel(current, previous ?? null, timeZone, smooth),
		[current, previous, smooth, timeZone],
	);
	const chartPoints = (buckets: NonNullable<typeof model.previous>) =>
		buckets.map((bucket) => ({ at: bucket.at, value: bucket.value, detail: bucketDetail(bucket) }));
	const unit = model.unit;
	const formatValue = useCallback((value: number) => formatExactValue(value, unit), [unit]);
	return (
		<div className="flex min-w-0 flex-col gap-3">
			{model.mixedUnits ? (
				<Notice tone="warning" title="Mixed units">
					This metric has readings in different units. The chart is hidden because those values
					cannot share one axis. Exact readings remain available below.
				</Notice>
			) : (
				<PeriodTrendChart
					compact={props.compact}
					formatValue={formatValue}
					timeZone={props.timeZone}
					current={chartPoints(model.current)}
					ariaLabel={`${props.metric.name} bucket averages`}
					label={`${props.metric.name} · Bucket averages · ${periodCaption(props.current.period)}`}
					previous={
						props.previous === undefined || model.previous === null
							? undefined
							: {
									points: chartPoints(model.previous),
									label: `Previous · ${periodCaption(props.previous.period)}`,
								}
					}
				/>
			)}
		</div>
	);
}

function MeasurementTrendPanel(props: {
	readonly smooth: boolean;
	readonly compact: boolean;
	readonly scope: AnalyticsScope;
	readonly metric: SelectedMetric;
	readonly onSmoothChange: (smooth: boolean) => void;
}) {
	const input = {
		metricId: props.metric.id,
		period: "current" as const,
		reference: props.scope.owner,
		timeZone: props.scope.timeZone,
		selection: props.scope.selection,
	};
	const current = useRyotQuery(measurementTrendQuery, input);
	const compare =
		props.scope.selection.range.kind !== "all-time" && props.scope.selection.comparison !== "none";
	return (
		<section aria-label="Measurement trend" className="flex min-w-0 flex-col gap-3">
			<h2 className="text-heading font-semibold text-text">Measurement trend</h2>
			<Checkbox
				checked={props.smooth}
				label="Smooth bucket averages (3/7-point)"
				onChange={(event) => props.onSmoothChange(event.currentTarget.checked)}
			/>
			{props.smooth ? (
				<p className="text-xs text-text-muted">
					Smoothing uses rolling averages of the grouped bucket averages. It uses 3 or 7 points,
					does not cross missing buckets or unit changes, and leaves exact readings unchanged.
				</p>
			) : null}
			<QueryStatus query={current} onRetry={current.refetch} label="measurement trend">
				{(data) =>
					compare ? (
						<PreviousMeasurementTrend
							current={data}
							scope={props.scope}
							metric={props.metric}
							smooth={props.smooth}
							compact={props.compact}
						/>
					) : (
						<TrendChart
							current={data}
							metric={props.metric}
							smooth={props.smooth}
							compact={props.compact}
							timeZone={props.scope.timeZone}
						/>
					)
				}
			</QueryStatus>
		</section>
	);
}

function ReadingsTable(props: {
	readonly timeZone: TimeZone;
	readonly readings: readonly MeasurementReading[];
	readonly query: ReturnType<typeof useSelectedReadings>;
}) {
	const { query, readings, timeZone } = props;
	return (
		<section aria-label="Loaded readings" className="flex min-w-0 flex-col gap-3">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-heading font-semibold text-text">Loaded readings</h2>
				<p className="text-sm text-text-muted tabular-nums">{readings.length} loaded</p>
			</div>
			<QueryStatus query={query} label="readings" onRetry={query.retry} />
			{query.pages.length > 0 ? (
				<div className="overflow-x-auto rounded-md border border-border">
					<table className="w-full min-w-120 border-collapse text-left text-sm">
						<caption className="sr-only">Loaded measurement readings in {timeZone}</caption>
						<thead>
							<tr>
								<th scope="col" className="px-3 py-2 font-medium text-text-muted">
									Date and time
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium text-text-muted">
									Exact value
								</th>
								<th scope="col" className="px-3 py-2 font-medium text-text-muted">
									Entry ID
								</th>
								<th scope="col" className="px-3 py-2 font-medium text-text-muted">
									Comment
								</th>
							</tr>
						</thead>
						<tbody>
							{readings.map((reading) => (
								<tr key={reading.id} className="border-t border-border">
									<th scope="row" className="px-3 py-2 font-normal text-text">
										{formatReadingTime(reading.occurredAt, timeZone)}
									</th>
									<td className="px-3 py-2 text-right tabular-nums">
										{formatExactValue(reading.value, reading.unit)}
									</td>
									<td className="px-3 py-2 break-all">
										{reading.entryId === null ? "—" : <code>{reading.entryId}</code>}
									</td>
									<td className="px-3 py-2 break-words">
										{reading.comment === null || reading.comment.trim() === ""
											? "—"
											: reading.comment}
									</td>
								</tr>
							))}
							{readings.length === 0 ? (
								<tr>
									<td colSpan={4} className="px-3 py-4 text-center text-text-muted">
										No readings in this period.
									</td>
								</tr>
							) : null}
						</tbody>
					</table>
				</div>
			) : null}
			{query.hasNextPage && !query.isError ? (
				<LoadMoreButton
					variant="secondary"
					className="self-center"
					label="Load more readings"
					disabled={query.isFetching}
					onClick={query.fetchNextPage}
					isFetchingNextPage={query.isFetchingNextPage}
				/>
			) : null}
		</section>
	);
}

function MetricPicker(props: {
	readonly compact: boolean;
	readonly onClose: () => void;
	readonly scope: AnalyticsScope;
	readonly onSelect: (metric: SelectedMetric) => void;
	readonly metricButtonRef: RefObject<null | HTMLButtonElement>;
}) {
	const { safeAreaBottom } = usePluginViewport();
	const metricsQuery = useRyotInfiniteQuery(
		analyticsMeasurementMetricsQuery,
		{
			reference: props.scope.owner,
			timeZone: props.scope.timeZone,
			selection: props.scope.selection,
		},
		{
			initialPageParam: null,
			getPageInput: analyticsPageInput,
			getNextPageParam: reportingPageParam,
		},
	);
	const metrics = useMemo(
		() =>
			paginationItems(
				metricsQuery.pages,
				(page) => page.items,
				({ id }) => id,
			),
		[metricsQuery.pages],
	);
	return (
		<Dialog
			onClose={props.onClose}
			safeAreaBottom={safeAreaBottom}
			closeLabel="Close metric picker"
			title="Choose measurement metric"
			triggerRef={props.metricButtonRef}
			placement={props.compact ? "sheet" : "center"}
			description="Select one metric to view its grouped averages and exact readings."
			footer={
				<Button variant="secondary" onClick={props.onClose}>
					Cancel
				</Button>
			}
		>
			<div className="flex flex-col gap-3">
				{metricsQuery.isPending ? <Skeleton className="h-12 w-full" /> : null}
				{metricsQuery.isError && metrics.length === 0 ? (
					<Notice
						tone="danger"
						title="Metrics could not be loaded"
						action={
							<Button
								variant="secondary"
								onClick={metricsQuery.retry}
								disabled={metricsQuery.isFetching}
							>
								Retry
							</Button>
						}
					>
						Your selected metric has not changed.
					</Notice>
				) : null}
				{metricsQuery.isError && metrics.length > 0 ? (
					<Notice
						tone="danger"
						title="More metrics could not be loaded"
						action={
							<Button
								variant="secondary"
								onClick={metricsQuery.retry}
								disabled={metricsQuery.isFetching}
							>
								Retry
							</Button>
						}
					>
						Loaded metric choices remain available.
					</Notice>
				) : null}
				{metricsQuery.pages.length > 0 && metrics.length === 0 ? (
					<EmptyState
						title="No measurement metrics"
						description="There are no metrics to select."
					/>
				) : null}
				{metrics.length > 0 ? (
					<ul className="flex flex-col divide-y divide-border">
						{metrics.map((item) => (
							<li key={item.id}>
								<Button
									variant="ghost"
									className="w-full justify-start py-3 text-left"
									onClick={() => props.onSelect({ id: item.id, name: item.name, unit: item.unit })}
								>
									<span className="flex min-w-0 flex-col items-start">
										<span className="truncate">{item.name}</span>
										{item.unit === null || item.unit === "" ? null : (
											<span className="text-xs text-text-muted">{item.unit}</span>
										)}
									</span>
								</Button>
							</li>
						))}
					</ul>
				) : null}
				{metricsQuery.hasNextPage && !metricsQuery.isError ? (
					<LoadMoreButton
						variant="secondary"
						className="self-center"
						label="Load more metrics"
						disabled={metricsQuery.isFetching}
						onClick={metricsQuery.fetchNextPage}
						isFetchingNextPage={metricsQuery.isFetchingNextPage}
					/>
				) : null}
			</div>
		</Dialog>
	);
}
