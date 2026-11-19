import {
	type ReportingCalendar,
	usePeriodCaption,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	type Compared,
	paginationItems,
	useFormatters,
	useReportedPages,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Checkbox,
	Dialog,
	EmptyState,
	LoadMoreButton,
	measureUnit,
	Notice,
	QueryStatus,
	ReportText,
	Skeleton,
	useMetricFormat,
} from "@ryot-app/plugin-ui-sdk";
import { formatReportingDateTime, PeriodTrendChart } from "@ryot-app/plugin-ui-sdk/charts";
import { DataTable } from "@ryot-app/plugin-ui-sdk/table";
import { type RefObject, useMemo, useRef, useState } from "react";

import { formatValue } from "../measurements/model";
import { useFitnessMessages } from "../messages";
import {
	analyticsMeasurementMetricsQuery,
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
	const text = useFitnessMessages();
	const { scope, compact } = props;
	const [metric, setMetric] = useState<null | SelectedMetric>(null);
	const [pickerOpen, setPickerOpen] = useState(false);
	const metricButtonRef = useRef<HTMLButtonElement>(null);
	return (
		<div className="flex min-w-0 flex-col gap-5">
			<section
				className="flex flex-col gap-2"
				aria-label={text("client.analytics.measurements.metric-heading")}
			>
				<h2 className="text-heading font-semibold text-text">
					{text("client.analytics.measurements.metric-heading")}
				</h2>
				<Button
					variant="secondary"
					ref={metricButtonRef}
					className="max-w-full self-start"
					onClick={() => setPickerOpen(true)}
				>
					<span className="min-w-0 truncate">
						{metric?.name ?? text("client.analytics.measurements.choose-metric")}
					</span>
				</Button>
				{metric === null ? (
					<ReportText>
						<p className="text-sm text-text-muted">
							{text("client.analytics.measurements.choose-metric-hint")}
						</p>
					</ReportText>
				) : (
					<>
						<ReportText>{metric.name}</ReportText>
						<SelectedMeasurement scope={scope} metric={metric} compact={compact} />
					</>
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

function useSelectedReadings(scope: AnalyticsScope, metricId: string) {
	return useReportedPages(measurementReadingsQuery, { ...scope, metricId });
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
			<ReadingsTable readings={readings} query={readingsQuery} />
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
	const text = useFitnessMessages();
	const trend = useRyotQuery(measurementTrendQuery, { ...props.scope, metricId: props.metric.id });
	return (
		<section
			className="flex min-w-0 flex-col gap-3"
			aria-label={text("client.analytics.measurements.trend-heading")}
		>
			<h2 className="text-heading font-semibold text-text">
				{text("client.analytics.measurements.trend-heading")}
			</h2>
			<Checkbox
				checked={props.smooth}
				label={text("client.analytics.measurements.smooth-label")}
				onChange={(event) => props.onSmoothChange(event.currentTarget.checked)}
			/>
			{props.smooth ? (
				<ReportText>
					<p className="text-xs text-text-muted">
						{text("client.analytics.measurements.smooth-note")}
					</p>
				</ReportText>
			) : null}
			<QueryStatus query={trend} onRetry={trend.refetch}>
				{(data) => (
					<TrendChart
						trend={data}
						metric={props.metric}
						smooth={props.smooth}
						compact={props.compact}
						calendar={data.reporting.resolved}
					/>
				)}
			</QueryStatus>
		</section>
	);
}

function TrendChart(props: {
	readonly smooth: boolean;
	readonly compact: boolean;
	readonly metric: SelectedMetric;
	readonly calendar: ReportingCalendar;
	readonly trend: Compared<MeasurementTrend>;
}) {
	const text = useFitnessMessages();
	const periodCaption = usePeriodCaption();
	const { formatMetric } = useMetricFormat();
	const { smooth, calendar } = props;
	const { current, previous } = props.trend;
	const model = useMemo(
		() => measurementTrendModel(text, current, previous, calendar, smooth),
		[text, current, previous, smooth, calendar],
	);
	const chartPoints = (buckets: NonNullable<typeof model.previous>) =>
		buckets.map((bucket) => ({
			at: bucket.at,
			value: bucket.value,
			detail:
				bucket.source === null || bucket.smoothing === null
					? bucket.detail
					: text("client.analytics.trend.detail-raw-average", {
							detail: bucket.detail,
							value: formatMetric(bucket.source.value, measureUnit(bucket.source.unit ?? "")),
						}),
		}));
	const unit = measureUnit(model.unit ?? "");
	return (
		<div className="flex min-w-0 flex-col gap-3">
			{model.mixedUnits ? (
				<Notice tone="warning" title={text("client.analytics.measurements.mixed-units-title")}>
					{text("client.analytics.measurements.mixed-units-body")}
				</Notice>
			) : (
				<PeriodTrendChart
					unit={unit}
					mark="line"
					compact={props.compact}
					grouping={current.grouping}
					timeZone={props.calendar.timeZone}
					current={chartPoints(model.current)}
					label={periodCaption(current.period)}
					ariaLabel={text("client.analytics.measurements.bucket-averages", {
						name: props.metric.name,
					})}
					previous={
						previous === null || model.previous === null
							? undefined
							: { points: chartPoints(model.previous), label: periodCaption(previous.period) }
					}
				/>
			)}
		</div>
	);
}

function ReadingsTable(props: {
	readonly readings: readonly MeasurementReading[];
	readonly query: ReturnType<typeof useSelectedReadings>;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { query, readings } = props;
	const firstPage = query.pages[0];
	return (
		<section
			className="flex min-w-0 flex-col gap-3"
			aria-label={text("client.analytics.measurements.readings-heading")}
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-heading font-semibold text-text">
					{text("client.analytics.measurements.readings-heading")}
				</h2>
				<ReportText>
					<p className="text-sm text-text-muted tabular-nums">
						{text("client.analytics.measurements.readings-loaded", { count: readings.length })}
					</p>
				</ReportText>
			</div>
			<QueryStatus query={query} onRetry={query.retry} />
			{firstPage !== undefined ? (
				<div className="overflow-x-auto rounded-md border border-border">
					<DataTable
						data={readings}
						getRowId={(reading) => reading.id}
						rowClassName="border-t border-border"
						cellClassName="px-3 py-2 break-words tabular-nums"
						headerCellClassName="px-3 py-2 font-medium text-text-muted"
						className="w-full min-w-120 border-collapse text-left text-sm"
						aria-label={text("client.analytics.measurements.readings-table-label", {
							timeZone: firstPage.reporting.resolved.timeZone,
						})}
						bodyEndRows={
							readings.length === 0
								? [
										{
											id: "empty",
											cellClassName: "px-3 py-4 text-center text-text-muted",
											content: text("client.analytics.measurements.readings-empty"),
										},
									]
								: []
						}
						columns={[
							{
								id: "date",
								rowHeader: true,
								cellClassName: "px-3 py-2 font-normal text-text",
								header: text("client.measurements.composer.date-time"),
								cell: (reading) =>
									formatReportingDateTime(
										formatters,
										reading.occurredAt,
										firstPage.reporting.resolved.timeZone,
									),
							},
							{
								id: "value",
								header: text("client.analytics.measurements.column-value"),
								cell: (reading) => formatValue(formatters, text, reading.value, reading.unit),
							},
							{
								id: "entry",
								cell: (reading) => reading.entryId ?? "—",
								header: text("client.analytics.measurements.column-entry"),
							},
							{
								id: "comment",
								header: text("property.comment"),
								cell: (reading) =>
									reading.comment === null || reading.comment.trim() === "" ? "—" : reading.comment,
							},
						]}
					/>
				</div>
			) : null}
			{query.hasNextPage && !query.isError ? (
				<LoadMoreButton
					variant="secondary"
					className="self-center"
					disabled={query.isFetching}
					onClick={query.fetchNextPage}
					isFetchingNextPage={query.isFetchingNextPage}
					label={text("client.analytics.measurements.load-more-readings")}
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
	const text = useFitnessMessages();
	const { safeAreaBottom } = useRyotViewport();
	const metricsQuery = useReportedPages(analyticsMeasurementMetricsQuery, props.scope);
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
			triggerRef={props.metricButtonRef}
			placement={props.compact ? "sheet" : "center"}
			title={text("client.analytics.measurements.picker-title")}
			closeLabel={text("client.analytics.measurements.picker-close")}
			description={text("client.analytics.measurements.picker-description")}
			footer={
				<Button variant="secondary" onClick={props.onClose}>
					{text("common.action.cancel")}
				</Button>
			}
		>
			<div className="flex flex-col gap-3">
				{metricsQuery.isPending ? <Skeleton className="h-12 w-full" /> : null}
				{metricsQuery.isError && metrics.length === 0 ? (
					<Notice
						tone="danger"
						title={text("client.analytics.measurements.metrics-load-failed")}
						action={
							<Button
								variant="secondary"
								onClick={metricsQuery.retry}
								disabled={metricsQuery.isFetching}
							>
								{text("common.action.retry")}
							</Button>
						}
					>
						{text("client.analytics.measurements.metrics-load-failed-detail")}
					</Notice>
				) : null}
				{metricsQuery.isError && metrics.length > 0 ? (
					<Notice
						tone="danger"
						title={text("client.analytics.measurements.metrics-more-failed")}
						action={
							<Button
								variant="secondary"
								onClick={metricsQuery.retry}
								disabled={metricsQuery.isFetching}
							>
								{text("common.action.retry")}
							</Button>
						}
					>
						{text("client.analytics.measurements.metrics-more-failed-detail")}
					</Notice>
				) : null}
				{metricsQuery.pages.length > 0 && metrics.length === 0 ? (
					<EmptyState
						title={text("client.analytics.measurements.metrics-empty-title")}
						description={text("client.analytics.measurements.metrics-empty-description")}
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
						disabled={metricsQuery.isFetching}
						onClick={metricsQuery.fetchNextPage}
						isFetchingNextPage={metricsQuery.isFetchingNextPage}
						label={text("client.analytics.measurements.load-more-metrics")}
					/>
				) : null}
			</div>
		</Dialog>
	);
}
