import {
	compareValues,
	formatExactValue,
	periodCaption,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import { Card, Notice, StatStrip } from "@ryot-app/plugin-ui-sdk";

import {
	type ConsumptionMeasureUnit,
	consumptionMeasureUnits,
} from "../../shared/consumption-allocation";
import { type reviewModel, type SummaryChartsProps, summaryModel } from "./model";

type QuantitySummary = ReturnType<typeof summaryModel>["current"]["quantities"]["pages"];

const measureLabels: Record<ConsumptionMeasureUnit, string> = {
	pages: "Pages",
	minutes: "Minutes",
	volumes: "Volumes",
	chapters: "Chapters",
	episodes: "Episodes",
};

const countValue = (value: null | number, unit: string) =>
	value === null ? "Unknown" : formatExactValue(value, unit);

const comparisonDetail = (
	current: null | number,
	previous: null | number | undefined,
	unit: string,
	currentCaption: string,
	previousCaption: null | string,
) => {
	if (previousCaption === null) {
		return `${currentCaption} · No previous period`;
	}
	const comparison = compareValues(current, previous ?? null);
	const periods = `${currentCaption} vs ${previousCaption}`;
	if (comparison.kind === "unknown") {
		return `${periods} · Change unavailable`;
	}
	if (comparison.kind === "new-activity") {
		return `${periods} · New activity · +${formatExactValue(comparison.absolute, unit)}`;
	}
	const delta = `${comparison.absolute > 0 ? "+" : ""}${formatExactValue(comparison.absolute, unit)}`;
	return `${periods} · ${delta}${comparison.percent === null ? "" : ` (${formatExactValue(comparison.percent, "%")})`}`;
};

const quantityDetail = (quantity: null | QuantitySummary, unit: string) => {
	if (quantity === null) {
		return "Known coverage unavailable · Recorded Unknown · Estimated Unknown · Missing Unknown";
	}
	return [
		`Known observations · ${formatExactValue(quantity.known, "observations")}`,
		`Recorded · ${formatExactValue(quantity.recorded, unit)}`,
		`Estimated · ${formatExactValue(quantity.estimated, unit)}`,
		`Missing observations · ${formatExactValue(quantity.missing, "observations")}`,
	].join(" · ");
};

export function MediaAnalyticsSummary(props: SummaryChartsProps) {
	const { compact } = useRyotViewport();
	const model = summaryModel(props.summary);
	const currentCaption = periodCaption(props.summary.reporting.resolved.current);
	const previousCaption =
		props.summary.reporting.resolved.previous === null
			? null
			: periodCaption(props.summary.reporting.resolved.previous);
	const current = model.current;
	const previous = model.previous;
	const comparison = (value: null | number, oldValue: null | number | undefined, unit: string) =>
		comparisonDetail(value, oldValue, unit, currentCaption, previousCaption);

	return (
		<section aria-label="Media analytics summary" className="flex min-w-0 flex-col gap-4 font-ui">
			<header className="min-w-0">
				<h2 className="text-heading font-semibold text-text">Consumption summary</h2>
				<p className="text-sm text-text-muted">
					Current period · {currentCaption}
					{previousCaption === null
						? " · No previous period"
						: ` · Previous period · ${previousCaption}`}
				</p>
			</header>
			{model.processing === "pending" ? (
				<Notice tone="warning">
					Consumption values are unavailable while source repair is pending. Reviews are
					independent.
				</Notice>
			) : null}
			{model.processing === "failed" ? (
				<Notice tone="danger">
					Consumption values are unavailable because source repair failed. Reviews are independent.
				</Notice>
			) : null}
			<StatStrip
				compact={compact}
				className="min-w-0"
				stats={[
					{
						key: "title-completions",
						label: "Title completion occurrences",
						value: countValue(current.titleCompletions, "titles"),
						detail: comparison(current.titleCompletions, previous?.titleCompletions, "titles"),
					},
					{
						key: "episode-completions",
						label: "Episode completion occurrences",
						value: countValue(current.episodeCompletions, "occurrences"),
						detail: comparison(
							current.episodeCompletions,
							previous?.episodeCompletions,
							"occurrences",
						),
					},
					{
						key: "distinct-titles",
						label: "Distinct completed titles",
						value: countValue(current.distinctTitles, "titles"),
						detail: comparison(current.distinctTitles, previous?.distinctTitles, "titles"),
					},
					{
						key: "active-days",
						label: "Active days",
						value: countValue(current.activeDays, "days"),
						detail: comparison(current.activeDays, previous?.activeDays, "days"),
					},
					{
						key: "active-observations",
						label: "Active observations",
						value: countValue(current.activeObservations, "observations"),
						detail: comparison(
							current.activeObservations,
							previous?.activeObservations,
							"observations",
						),
					},
				]}
			/>
			<p className="text-sm text-text-muted">
				Episode completion counts cover show and podcast episodes. Independent numbered items are
				included in their unit totals.
			</p>
			<Card className="flex min-w-0 flex-col gap-3">
				<h3 className="text-body font-semibold text-text">Quantity coverage</h3>
				<p className="text-sm text-text-muted">
					Units stay separate. Recorded and estimated quantities are not added across measures.
				</p>
				<div
					className={
						compact
							? "grid min-w-0 grid-cols-1 gap-x-5 gap-y-4"
							: "grid min-w-0 grid-cols-2 gap-x-5 gap-y-4"
					}
				>
					{consumptionMeasureUnits.map((unit) => {
						const quantity = current.quantities[unit];
						return (
							<dl key={unit} className="flex min-w-0 flex-col gap-1">
								<dt className="text-label text-text-muted">{measureLabels[unit]}</dt>
								<dd className="break-words text-body font-semibold text-text tabular-nums">
									{quantity.value === null
										? "Unknown"
										: `${quantity.partial ? "≥ " : ""}${formatExactValue(quantity.value, unit)}`}
								</dd>
								<dd className="break-words text-xs text-text-subtle">
									{quantityDetail(quantity, unit)}
								</dd>
							</dl>
						);
					})}
				</div>
				{model.unknownDate !== null && model.unknownDate > 0 ? (
					<p className="text-sm text-text-muted">
						Full-history source coverage includes{" "}
						{formatExactValue(model.unknownDate, "unknown-date observations")}; these records are
						not assigned to a reporting date.
					</p>
				) : null}
			</Card>
			<Card className="flex min-w-0 flex-col gap-3">
				<h3 className="text-body font-semibold text-text">By media type</h3>
				<p className="text-sm text-text-muted">
					Episode and season rows remain separate from parent titles. Parent and child quantities
					are not combined.
				</p>
				<div className="min-w-0 overflow-x-auto">
					<table className="w-full min-w-[48rem] border-collapse text-left text-sm">
						<caption className="sr-only">
							Completion, activity, distinct-title, active-day, and quantity coverage by media type
						</caption>
						<thead className="text-xs text-text-muted">
							<tr>
								<th scope="col" className="py-2 pr-3 font-medium">
									Media type
								</th>
								<th scope="col" className="py-2 pr-3 font-medium">
									Title completions
								</th>
								<th scope="col" className="py-2 pr-3 font-medium">
									Episode completions
								</th>
								<th scope="col" className="py-2 pr-3 font-medium">
									Active observations
								</th>
								<th scope="col" className="py-2 pr-3 font-medium">
									Distinct titles
								</th>
								<th scope="col" className="py-2 pr-3 font-medium">
									Active days
								</th>
								<th scope="col" className="py-2 font-medium">
									Quantity coverage
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-border">
							{current.types.map((row) => (
								<tr key={row.source.mediaType}>
									<th scope="row" className="py-2 pr-3 align-top font-medium text-text">
										{row.source.label}
									</th>
									<td className="py-2 pr-3 align-top tabular-nums text-text">
										{countValue(row.titleCompletions, "titles")}
									</td>
									<td className="py-2 pr-3 align-top tabular-nums text-text">
										{countValue(row.episodeCompletions, "occurrences")}
									</td>
									<td className="py-2 pr-3 align-top tabular-nums text-text">
										{countValue(row.activeObservations, "observations")}
									</td>
									<td className="py-2 pr-3 align-top tabular-nums text-text">
										{countValue(row.distinctTitles, "titles")}
									</td>
									<td className="py-2 pr-3 align-top tabular-nums text-text">
										{countValue(row.activeDays, "days")}
									</td>
									<td className="py-2 align-top">
										<div className="flex min-w-48 flex-col gap-2">
											{consumptionMeasureUnits.map((unit) => {
												return (
													<p key={unit} className="text-xs text-text-muted">
														<span className="font-medium text-text">{measureLabels[unit]} · </span>
														{quantityDetail(row.quantities[unit], unit)}
													</p>
												);
											})}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Card>
			<Card className="flex min-w-0 flex-col gap-3">
				<h3 className="text-body font-semibold text-text">Reviews</h3>
				<div
					className={compact ? "grid min-w-0 grid-cols-1 gap-4" : "grid min-w-0 grid-cols-2 gap-4"}
				>
					<ReviewGlobal reviews={current.reviews} label={`Current · ${currentCaption}`} />
					{previous === null ? (
						<p className="text-sm text-text-muted">No previous review period.</p>
					) : (
						<ReviewGlobal reviews={previous.reviews} label={`Previous · ${previousCaption}`} />
					)}
				</div>
				<div className="min-w-0 overflow-x-auto">
					<table className="w-full min-w-[36rem] border-collapse text-left text-sm">
						<caption className="sr-only">Review count and rating by media category</caption>
						<thead className="text-xs text-text-muted">
							<tr>
								<th scope="col" className="py-2 pr-3 font-medium">
									Category
								</th>
								<th scope="col" className="py-2 pr-3 font-medium">
									Current reviews
								</th>
								<th scope="col" className="py-2 pr-3 font-medium">
									Current rated
								</th>
								<th scope="col" className="py-2 pr-3 font-medium">
									Current average
								</th>
								<th scope="col" className="py-2 pr-3 font-medium">
									Previous reviews
								</th>
								<th scope="col" className="py-2 pr-3 font-medium">
									Previous rated
								</th>
								<th scope="col" className="py-2 font-medium">
									Previous average
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-border">
							{reviewCategories(current.reviews.categories, previous?.reviews.categories ?? []).map(
								({ current: row, previous: old }) => (
									<tr key={row?.mediaType ?? old?.mediaType}>
										<th scope="row" className="py-2 pr-3 font-medium text-text">
											{row?.label ?? old?.label}
										</th>
										<td className="py-2 pr-3 tabular-nums">
											{formatExactValue(row?.reviews ?? null, "reviews")}
										</td>
										<td className="py-2 pr-3 tabular-nums">
											{formatExactValue(row?.rated ?? null, "ratings")}
										</td>
										<td className="py-2 pr-3 tabular-nums">
											{formatExactValue(row?.averageRating ?? null, "/100")}
										</td>
										<td className="py-2 pr-3 tabular-nums">
											{formatExactValue(old?.reviews ?? null, "reviews")}
										</td>
										<td className="py-2 pr-3 tabular-nums">
											{formatExactValue(old?.rated ?? null, "ratings")}
										</td>
										<td className="py-2 tabular-nums">
											{formatExactValue(old?.averageRating ?? null, "/100")}
										</td>
									</tr>
								),
							)}
						</tbody>
					</table>
				</div>
			</Card>
		</section>
	);
}

function ReviewGlobal(props: {
	readonly label: string;
	readonly reviews: ReturnType<typeof reviewModel>;
}) {
	return (
		<dl className="flex min-w-0 flex-col gap-1">
			<dt className="text-label text-text-muted">{props.label}</dt>
			<dd className="break-words text-sm text-text">
				{formatExactValue(props.reviews.reviews, "reviews")} ·{" "}
				{formatExactValue(props.reviews.rated, "rated")}
			</dd>
			<dd className="break-words text-sm text-text-muted">
				Source average · {formatExactValue(props.reviews.averageRating, "/100")}
			</dd>
		</dl>
	);
}

const reviewCategories = <Category extends { readonly mediaType: string }>(
	current: readonly Category[],
	previous: readonly Category[],
) => {
	const before = new Map(previous.map((row) => [row.mediaType, row]));
	return [
		...current.map((row) => ({ current: row, previous: before.get(row.mediaType) })),
		...previous
			.filter((row) => !current.some((item) => item.mediaType === row.mediaType))
			.map((row) => ({ previous: row, current: undefined })),
	];
};
