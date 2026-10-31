import { periodCaption, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import {
	ChartCard,
	countUnit,
	formatMetric,
	formatNumber,
	measureUnit,
	type Metric,
	metricDelta,
	MetricGrid,
} from "@ryot-app/plugin-ui-sdk";
import { CoverageBar } from "@ryot-app/plugin-ui-sdk/charts";

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
const ratingUnit = countUnit("rating");
const ratingScaleUnit = measureUnit("/ 100");
const undatedUnit = countUnit("undated entry", "undated entries");

const formatRating = (value: null | number) =>
	value === null ? "—" : `${formatNumber(value)}/100`;

const typeAmounts = (row: PeriodModel["types"][number]) =>
	consumptionMeasureUnits
		.filter((unit) => unit !== "minutes" && row.quantities[unit].value !== null)
		.map((unit) => formatMetric(row.quantities[unit].value, measureUnits[unit]))
		.join(" · ");

export function MediaAnalyticsSummary(props: SummaryChartsProps) {
	const { compact } = useRyotViewport();
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
									<div className="flex min-w-0 items-baseline justify-between gap-3">
										<span className="text-label text-text-muted">{measureLabels[unit]}</span>
										<span className="text-body font-semibold text-text tabular-nums">
											{quantity.partial ? "≥ " : ""}
											{formatMetric(quantity.value, measure)}
										</span>
									</div>
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
										<p className="text-micro text-text-subtle">
											{formatMetric(quantity.missing, entryUnit)} without an amount
										</p>
									) : null}
								</div>
							);
						})}
					</div>
					{model.unknownDate > 0 ? (
						<p className="text-micro text-text-subtle">
							Not counted in any period: {formatMetric(model.unknownDate, undatedUnit)}.
						</p>
					) : null}
				</ChartCard>
			)}
			{types.length === 0 ? null : (
				<ChartCard
					title="By media type"
					description="Episodes and seasons are counted separately from their shows."
				>
					<div className="min-w-0 overflow-x-auto">
						<table className="w-full min-w-[36rem] border-collapse text-left text-label">
							<caption className="sr-only">
								Completions, activity, and amounts by media type
							</caption>
							<thead className="text-text-muted">
								<tr className="border-b border-border">
									<th scope="col" className="py-2 pr-3 font-medium">
										Type
									</th>
									<th scope="col" className="py-2 pr-3 text-right font-medium">
										Completed
									</th>
									<th scope="col" className="py-2 pr-3 text-right font-medium">
										Episodes
									</th>
									<th scope="col" className="py-2 pr-3 text-right font-medium">
										Active days
									</th>
									<th scope="col" className="py-2 pr-3 text-right font-medium">
										Time spent
									</th>
									<th scope="col" className="py-2 text-right font-medium">
										Other amounts
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{types.map((row) => (
									<tr key={row.source.mediaType}>
										<th scope="row" className="py-2.5 pr-3 font-medium text-text">
											{row.source.label}
										</th>
										<td className="py-2.5 pr-3 text-right text-text tabular-nums">
											{formatNumber(row.titleCompletions)}
										</td>
										<td className="py-2.5 pr-3 text-right text-text tabular-nums">
											{formatNumber(row.episodeCompletions)}
										</td>
										<td className="py-2.5 pr-3 text-right text-text tabular-nums">
											{formatNumber(row.activeDays)}
										</td>
										<td className="py-2.5 pr-3 text-right text-text tabular-nums">
											{row.quantities.minutes.value === null
												? "—"
												: formatMetric(row.quantities.minutes.value, measureUnits.minutes)}
										</td>
										<td className="py-2.5 text-right text-text-muted tabular-nums">
											{typeAmounts(row) || "—"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</ChartCard>
			)}
			<ChartCard title="Reviews">
				<ReviewFigures reviews={current.reviews} previous={previous?.reviews ?? null} />
				{current.reviews.categories.length === 0 ? null : (
					<div className="min-w-0 overflow-x-auto">
						<table className="w-full min-w-[28rem] border-collapse text-left text-label">
							<caption className="sr-only">Review count and rating by media category</caption>
							<thead className="text-text-muted">
								<tr className="border-b border-border">
									<th scope="col" className="py-2 pr-3 font-medium">
										Category
									</th>
									<th scope="col" className="py-2 pr-3 text-right font-medium">
										Reviews
									</th>
									<th scope="col" className="py-2 pr-3 text-right font-medium">
										Rated
									</th>
									<th scope="col" className="py-2 text-right font-medium">
										Average rating
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{current.reviews.categories.map((row) => (
									<tr key={row.mediaType}>
										<th scope="row" className="py-2.5 pr-3 font-medium text-text">
											{row.label}
										</th>
										<td className="py-2.5 pr-3 text-right tabular-nums">
											{formatNumber(row.reviews)}
										</td>
										<td className="py-2.5 pr-3 text-right tabular-nums">
											{formatNumber(row.rated ?? 0)}
										</td>
										<td className="py-2.5 text-right tabular-nums">
											{formatRating(row.averageRating ?? null)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				{props.summary.reporting.resolved.previous === null ? null : (
					<p className="text-micro text-text-subtle">
						Changes compare with {periodCaption(props.summary.reporting.resolved.previous)}.
					</p>
				)}
			</ChartCard>
		</section>
	);
}

function ReviewFigures(props: {
	readonly reviews: ReturnType<typeof reviewModel>;
	readonly previous: null | ReturnType<typeof reviewModel>;
}) {
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
					unit: ratingUnit,
					value: props.reviews.rated,
					delta:
						props.previous === null
							? undefined
							: metricDelta(props.reviews.rated, props.previous.rated),
				},
				{
					key: "average",
					unit: ratingScaleUnit,
					label: "Average rating",
					value: props.reviews.averageRating,
					delta:
						props.previous === null
							? undefined
							: metricDelta(props.reviews.averageRating, props.previous.averageRating),
				},
			]}
		/>
	);
}
