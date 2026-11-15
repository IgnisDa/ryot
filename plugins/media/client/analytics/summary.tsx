import type { RatingScale } from "@ryot-app/plugin-client-sdk";
import { periodCaption, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { useUserPreferences } from "@ryot-app/plugin-client-sdk/react";
import {
	ChartCard,
	countUnit,
	formatMetric,
	formatNumber,
	type Metric,
	metricDelta,
	MetricGrid,
	ratingUnit,
	ReportText,
} from "@ryot-app/plugin-ui-sdk";
import { CoverageBar } from "@ryot-app/plugin-ui-sdk/charts";
import { DataTable } from "@ryot-app/plugin-ui-sdk/table";

import { consumptionMeasureUnits } from "../../shared/consumption-allocation";
import {
	dayUnit,
	entryUnit,
	episodeUnit,
	measureLabels,
	measureUnits,
	type reviewModel,
	type SummaryChartsProps,
	summaryModel,
	titleUnit,
	uniqueTitleUnit,
} from "./model";

type PeriodModel = ReturnType<typeof summaryModel>["current"];

const reviewUnit = countUnit("review");
const ratedUnit = countUnit("rating");
const undatedUnit = countUnit("undated entry", "undated entries");

const typeAmounts = (row: PeriodModel["types"][number]) =>
	consumptionMeasureUnits
		.filter((unit) => unit !== "minutes" && row.quantities[unit].value !== null)
		.map((unit) => formatMetric(row.quantities[unit].value, measureUnits[unit]))
		.join(" · ");

export function MediaAnalyticsSummary(props: SummaryChartsProps) {
	const { compact } = useRyotViewport();
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
			label: "Titles completed",
			value: current.titleCompletions,
			hint: formatMetric(current.distinctTitles, uniqueTitleUnit),
			delta: delta(current.titleCompletions, previous?.titleCompletions),
		},
		{
			unit: episodeUnit,
			key: "episode-completions",
			label: "Episodes finished",
			hint: "Shows and podcasts",
			value: current.episodeCompletions,
			delta: delta(current.episodeCompletions, previous?.episodeCompletions),
		},
		{
			key: "minutes",
			label: "Time spent",
			value: minutes.value,
			atLeast: minutes.partial,
			unit: measureUnits.minutes,
			delta: delta(minutes.value, previous?.quantities.minutes.value),
		},
		{
			unit: dayUnit,
			key: "active-days",
			label: "Active days",
			value: current.activeDays,
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
		<section aria-label="Media analytics summary" className="flex min-w-0 flex-col gap-4 font-ui">
			<ReportText>
				<p className="text-label text-text-muted">
					{periodCaption(props.summary.reporting.resolved.current)}
				</p>
			</ReportText>
			<MetricGrid
				variant="tiles"
				compact={compact}
				metrics={metrics}
				comparisonLabel="vs previous period"
			/>
			{amounts.length === 0 ? null : (
				<ChartCard
					title="Amounts"
					description="Recorded amounts plus estimates from title lengths. Each unit is counted separately."
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
											<span className="text-label text-text-muted">{measureLabels[unit]}</span>
											<span className="text-body font-semibold text-text tabular-nums">
												{quantity.partial ? "≥ " : ""}
												{formatMetric(quantity.value, measure)}
											</span>
										</div>
									</ReportText>
									<CoverageBar
										ariaLabel={`${measureLabels[unit]} sources`}
										formatValue={(segment) => formatMetric(segment.value, measure)}
										segments={[
											{
												tone: "solid",
												key: "recorded",
												label: "Recorded",
												value: quantity.recorded,
											},
											{
												tone: "soft",
												key: "estimated",
												label: "Estimated",
												value: quantity.estimated,
											},
										]}
									/>
									{quantity.missing > 0 ? (
										<ReportText>
											<p className="text-micro text-text-subtle">
												{formatMetric(quantity.missing, entryUnit)} without an amount
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
								Not counted in any period: {formatMetric(model.unknownDate, undatedUnit)}.
							</p>
						</ReportText>
					) : null}
				</ChartCard>
			)}
			{types.length === 0 ? null : (
				<ChartCard
					title="By media type"
					description="Episodes and seasons are counted separately from their shows."
				>
					<div className="min-w-0 overflow-x-auto">
						<DataTable
							data={types}
							rowClassName="border-b border-border"
							getRowId={(row) => row.source.mediaType}
							headerCellClassName="py-2 pr-3 font-medium text-right"
							headerClassName="text-text-muted border-b border-border"
							aria-label="Completions, activity, and amounts by media type"
							cellClassName="py-2.5 pr-3 text-text tabular-nums text-right"
							className="w-full min-w-[36rem] border-collapse text-left text-label"
							columns={[
								{
									id: "type",
									header: "Type",
									rowHeader: true,
									cell: (row) => row.source.label,
									headerClassName: "py-2 pr-3 font-medium text-left",
									cellClassName: "py-2.5 pr-3 font-medium text-text",
								},
								{
									id: "completed",
									header: "Completed",
									cell: (row) => formatNumber(row.titleCompletions),
								},
								{
									id: "episodes",
									header: "Episodes",
									cell: (row) => formatNumber(row.episodeCompletions),
								},
								{ id: "days", header: "Active days", cell: (row) => formatNumber(row.activeDays) },
								{
									id: "time",
									header: "Time spent",
									cell: (row) =>
										row.quantities.minutes.value === null
											? "—"
											: formatMetric(row.quantities.minutes.value, measureUnits.minutes),
								},
								{ id: "amounts", header: "Other amounts", cell: (row) => typeAmounts(row) || "—" },
							]}
						/>
					</div>
				</ChartCard>
			)}
			<ChartCard title="Reviews">
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
							aria-label="Review count and rating by media category"
							headerCellClassName="py-2 pr-3 font-medium text-right"
							headerClassName="text-text-muted border-b border-border"
							cellClassName="py-2.5 pr-3 text-text tabular-nums text-right"
							className="w-full min-w-[28rem] border-collapse text-left text-label"
							columns={[
								{
									id: "category",
									rowHeader: true,
									header: "Category",
									cell: (row) => row.label,
									headerClassName: "py-2 pr-3 font-medium text-left",
									cellClassName: "py-2.5 pr-3 font-medium text-text",
								},
								{ id: "reviews", header: "Reviews", cell: (row) => formatNumber(row.reviews) },
								{ id: "rated", header: "Rated", cell: (row) => formatNumber(row.rated ?? 0) },
								{
									id: "average",
									header: "Average rating",
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
							Changes compare with {periodCaption(props.summary.reporting.resolved.previous)}.
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
	return (
		<MetricGrid
			variant="plain"
			compact={compact}
			comparisonLabel="vs previous period"
			metrics={[
				{
					key: "reviews",
					label: "Reviews",
					unit: reviewUnit,
					value: props.reviews.reviews,
					delta:
						props.previous === null
							? undefined
							: metricDelta(props.reviews.reviews, props.previous.reviews),
				},
				{
					key: "rated",
					label: "Rated",
					unit: ratedUnit,
					value: props.reviews.rated,
					delta:
						props.previous === null
							? undefined
							: metricDelta(props.reviews.rated, props.previous.rated),
				},
				{
					key: "average",
					label: "Average rating",
					unit: ratingUnit(ratingScale ?? "hundred"),
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
