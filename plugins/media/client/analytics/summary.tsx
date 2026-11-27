import type { RatingScale } from "@ryot-app/plugin-client-sdk";
import { usePeriodCaption, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { useT, useUserPreferences } from "@ryot-app/plugin-client-sdk/react";
import {
	ChartCard,
	countUnit,
	type Metric,
	metricDelta,
	type MetricFormat,
	MetricGrid,
	ratingUnit,
	ReportText,
	useMetricFormat,
} from "@ryot-app/plugin-ui-sdk";
import { CoverageBar } from "@ryot-app/plugin-ui-sdk/charts";
import { DataTable } from "@ryot-app/plugin-ui-sdk/table";
import { useMemo } from "react";

import { consumptionMeasureUnits } from "../../shared/consumption-allocation";
import { useMediaMessages } from "../messages";
import {
	measureLabel,
	type reviewModel,
	type SummaryChartsProps,
	summaryModel,
	useAnalyticsUnits,
} from "./model";

type AnalyticsUnits = ReturnType<typeof useAnalyticsUnits>;

type PeriodModel = ReturnType<typeof summaryModel>["current"];

const typeAmounts = (
	units: AnalyticsUnits,
	format: MetricFormat,
	row: PeriodModel["types"][number],
) =>
	consumptionMeasureUnits
		.filter((unit) => unit !== "minutes" && row.quantities[unit].value !== null)
		.map((unit) => format.formatMetric(row.quantities[unit].value, units.measureUnits[unit]))
		.join(" · ");

const useReviewUnits = () => {
	const text = useMediaMessages();
	return useMemo(
		() => ({
			ratedUnit: countUnit((count) => text("analytics.unit.rating", { count })),
			reviewUnit: countUnit((count) => text("analytics.unit.review", { count })),
			undatedUnit: countUnit((count) => text("analytics.unit.undated-entry", { count })),
		}),
		[text],
	);
};

export function MediaAnalyticsSummary(props: SummaryChartsProps) {
	const periodCaption = usePeriodCaption();
	const format = useMetricFormat();
	const { formatMetric, formatNumber } = format;
	const { compact } = useRyotViewport();
	const t = useT();
	const text = useMediaMessages();
	const units = useAnalyticsUnits();
	const { undatedUnit } = useReviewUnits();
	const { dayUnit, titleUnit, entryUnit, episodeUnit, measureUnits, uniqueTitleUnit } = units;
	const ratingScale = useUserPreferences().data?.ratingScale;
	const model = summaryModel(props.summary);
	const { current, previous } = model;
	const delta = (value: null | number, old: null | number | undefined) =>
		previous === null ? undefined : metricDelta(value, old ?? null);
	const minutes = current.quantities.minutes;
	const metrics: Metric[] = [
		{
			unit: titleUnit,
			key: "title-completions",
			value: current.titleCompletions,
			label: text("analytics.metric.titles-completed"),
			hint: formatMetric(current.distinctTitles, uniqueTitleUnit),
			delta: delta(current.titleCompletions, previous?.titleCompletions),
		},
		{
			unit: episodeUnit,
			key: "episode-completions",
			value: current.episodeCompletions,
			hint: text("analytics.summary.episodes-hint"),
			label: text("analytics.metric.episodes-finished"),
			delta: delta(current.episodeCompletions, previous?.episodeCompletions),
		},
		{
			key: "minutes",
			value: minutes.value,
			atLeast: minutes.partial,
			unit: measureUnits.minutes,
			label: measureLabel(text, "minutes"),
			delta: delta(minutes.value, previous?.quantities.minutes.value),
		},
		{
			unit: dayUnit,
			key: "active-days",
			value: current.activeDays,
			label: text("analytics.summary.active-days"),
			delta: delta(current.activeDays, previous?.activeDays),
			hint: formatMetric(current.activeObservations, entryUnit),
		},
	];
	const amounts = consumptionMeasureUnits.filter((unit) => current.quantities[unit].value !== null);
	const types = current.types
		.filter(
			(row) =>
				row.activeDays > 0 ||
				row.titleCompletions > 0 ||
				row.episodeCompletions > 0 ||
				row.activeObservations > 0,
		)
		.sort((left, right) => right.activeObservations - left.activeObservations);

	return (
		<section
			className="flex min-w-0 flex-col gap-4 font-ui"
			aria-label={text("analytics.summary.aria-label")}
		>
			<ReportText>
				<p className="text-label text-text-muted">
					{periodCaption(props.summary.reporting.resolved.current)}
				</p>
			</ReportText>
			<MetricGrid
				variant="tiles"
				compact={compact}
				metrics={metrics}
				comparisonLabel={text("analytics.summary.comparison")}
			/>
			{amounts.length === 0 ? null : (
				<ChartCard
					title={text("analytics.summary.amounts-title")}
					description={text("analytics.summary.amounts-description")}
				>
					<div
						className={compact ? "grid min-w-0 gap-5" : "grid min-w-0 grid-cols-2 gap-x-8 gap-y-5"}
					>
						{amounts.map((unit) => {
							const quantity = current.quantities[unit];
							const measure = measureUnits[unit];
							return (
								<div key={unit} className="flex min-w-0 flex-col gap-2">
									<ReportText>
										<div className="flex min-w-0 items-baseline justify-between gap-3">
											<span className="text-label text-text-muted">{measureLabel(text, unit)}</span>
											<span className="text-body font-semibold text-text tabular-nums">
												{quantity.partial ? "≥ " : ""}
												{formatMetric(quantity.value, measure)}
											</span>
										</div>
									</ReportText>
									<CoverageBar
										formatValue={(segment) => formatMetric(segment.value, measure)}
										ariaLabel={text("analytics.summary.sources-label", {
											unit: measureLabel(text, unit),
										})}
										segments={[
											{
												tone: "solid",
												key: "recorded",
												value: quantity.recorded,
												label: text("analytics.summary.recorded"),
											},
											{
												tone: "soft",
												key: "estimated",
												value: quantity.estimated,
												label: text("analytics.summary.estimated"),
											},
										]}
									/>
									{quantity.missing > 0 ? (
										<ReportText>
											<p className="text-micro text-text-subtle">
												{text("analytics.summary.missing-amount", {
													amount: formatMetric(quantity.missing, entryUnit),
												})}
											</p>
										</ReportText>
									) : null}
								</div>
							);
						})}
					</div>
					{model.unknownDate > 0 ? (
						<ReportText>
							<p className="text-micro text-text-subtle">
								{text("analytics.summary.undated", {
									amount: formatMetric(model.unknownDate, undatedUnit),
								})}
							</p>
						</ReportText>
					) : null}
				</ChartCard>
			)}
			{types.length === 0 ? null : (
				<ChartCard
					title={text("analytics.summary.types-title")}
					description={text("analytics.summary.types-description")}
				>
					<div className="min-w-0 overflow-x-auto">
						<DataTable
							data={types}
							rowClassName="border-b border-border"
							getRowId={(row) => row.source.mediaType}
							headerCellClassName="py-2 pr-3 font-medium text-right"
							headerClassName="text-text-muted border-b border-border"
							aria-label={text("analytics.summary.types-table-label")}
							cellClassName="py-2.5 pr-3 text-text tabular-nums text-right"
							className="w-full min-w-[36rem] border-collapse text-left text-label"
							columns={[
								{
									id: "type",
									rowHeader: true,
									header: text("property.type"),
									cell: (row) => t(row.source.label),
									headerClassName: "py-2 pr-3 font-medium text-left",
									cellClassName: "py-2.5 pr-3 font-medium text-text",
								},
								{
									id: "completed",
									cell: (row) => formatNumber(row.titleCompletions),
									header: text("analytics.summary.column-completed"),
								},
								{
									id: "episodes",
									header: measureLabel(text, "episodes"),
									cell: (row) => formatNumber(row.episodeCompletions),
								},
								{
									id: "days",
									cell: (row) => formatNumber(row.activeDays),
									header: text("analytics.summary.active-days"),
								},
								{
									id: "time",
									header: measureLabel(text, "minutes"),
									cell: (row) =>
										row.quantities.minutes.value === null
											? "—"
											: formatMetric(row.quantities.minutes.value, measureUnits.minutes),
								},
								{
									id: "amounts",
									cell: (row) => typeAmounts(units, format, row) || "—",
									header: text("analytics.summary.column-other-amounts"),
								},
							]}
						/>
					</div>
				</ChartCard>
			)}
			<ChartCard title={text("activity.figure-reviews")}>
				<ReviewFigures
					ratingScale={ratingScale}
					reviews={current.reviews}
					previous={previous?.reviews ?? null}
				/>
				{current.reviews.categories.length === 0 ? null : (
					<div className="min-w-0 overflow-x-auto">
						<DataTable
							data={current.reviews.categories}
							getRowId={(row) => row.mediaType}
							rowClassName="border-b border-border"
							headerCellClassName="py-2 pr-3 font-medium text-right"
							headerClassName="text-text-muted border-b border-border"
							aria-label={text("analytics.summary.reviews-table-label")}
							cellClassName="py-2.5 pr-3 text-text tabular-nums text-right"
							className="w-full min-w-[28rem] border-collapse text-left text-label"
							columns={[
								{
									id: "category",
									rowHeader: true,
									cell: (row) => t(row.label),
									header: text("analytics.table.category"),
									headerClassName: "py-2 pr-3 font-medium text-left",
									cellClassName: "py-2.5 pr-3 font-medium text-text",
								},
								{
									id: "reviews",
									header: text("activity.figure-reviews"),
									cell: (row) => formatNumber(row.reviews),
								},
								{
									id: "rated",
									header: text("analytics.summary.rated"),
									cell: (row) => formatNumber(row.rated ?? 0),
								},
								{
									id: "average",
									header: text("analytics.summary.average-rating"),
									cell: (row) =>
										row.averageRating == null || ratingScale === undefined
											? "—"
											: formatMetric(row.averageRating, ratingUnit(ratingScale)),
								},
							]}
						/>
					</div>
				)}
				{props.summary.reporting.resolved.previous === null ? null : (
					<ReportText>
						<p className="text-micro text-text-subtle">
							{text("analytics.summary.compares-with", {
								period: periodCaption(props.summary.reporting.resolved.previous),
							})}
						</p>
					</ReportText>
				)}
			</ChartCard>
		</section>
	);
}

function ReviewFigures(props: {
	readonly ratingScale: undefined | RatingScale;
	readonly reviews: ReturnType<typeof reviewModel>;
	readonly previous: null | ReturnType<typeof reviewModel>;
}) {
	const { ratingScale } = props;
	const { compact } = useRyotViewport();
	const text = useMediaMessages();
	const { ratedUnit, reviewUnit } = useReviewUnits();
	return (
		<MetricGrid
			variant="plain"
			compact={compact}
			comparisonLabel={text("analytics.summary.comparison")}
			metrics={[
				{
					key: "reviews",
					unit: reviewUnit,
					value: props.reviews.reviews,
					label: text("activity.figure-reviews"),
					delta:
						props.previous === null
							? undefined
							: metricDelta(props.reviews.reviews, props.previous.reviews),
				},
				{
					key: "rated",
					unit: ratedUnit,
					value: props.reviews.rated,
					label: text("analytics.summary.rated"),
					delta:
						props.previous === null
							? undefined
							: metricDelta(props.reviews.rated, props.previous.rated),
				},
				{
					key: "average",
					unit: ratingUnit(ratingScale ?? "hundred"),
					label: text("analytics.summary.average-rating"),
					value: ratingScale === undefined ? null : props.reviews.averageRating,
					delta:
						props.previous === null
							? undefined
							: metricDelta(props.reviews.averageRating, props.previous.averageRating),
				},
			]}
		/>
	);
}
