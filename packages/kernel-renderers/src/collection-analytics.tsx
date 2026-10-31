import {
	calendarBuckets,
	periodCaption,
	PluginLink,
	type Reported,
	type ReportingSelection,
	type TimeZone,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	createReportedPageQuery,
	createReportedQuery,
	paginationItems,
	useReportedPages,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Badge,
	ChartCard,
	countUnit,
	DeltaBadge,
	EmptyState,
	formatMetric,
	LoadMoreButton,
	metricDelta,
	QueryStatus,
} from "@ryot-app/plugin-ui-sdk";
import { formatReportingDateTime, PeriodTrendChart } from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	type CollectionReviewAnalytics,
	collectionReviewAnalyticsRecipe,
	type CollectionReviewRecords,
	collectionReviewRecordsRecipe,
} from "@ryot-app/ryotql-recipes/collection-analytics";

type Selection = { readonly timeZone: TimeZone; readonly selection: ReportingSelection };

const summaryQuery = createReportedQuery<Selection, CollectionReviewAnalytics>(
	({ client, reporting }) => client.data.query(collectionReviewAnalyticsRecipe({ reporting })),
);

const recordsQuery = createReportedPageQuery<Selection, CollectionReviewRecords>(
	({ after, client, reporting }) =>
		client.data.query(collectionReviewRecordsRecipe({ after, period: reporting.current })),
);

const reviewUnit = countUnit("review");

const reviewTrend = (summary: Reported<CollectionReviewAnalytics>) =>
	calendarBuckets(summary.buckets.items, {
		at: (bucket) => bucket.at,
		period: summary.reporting.resolved.current,
		timeZone: summary.reporting.resolved.timeZone,
		grouping: summary.reporting.resolved.grouping,
	}).map((bucket) => ({
		at: bucket.date,
		value: bucket.points.reduce((total, point) => total + point.count, 0),
	}));

export function CollectionAnalytics(input: Selection) {
	const { compact } = useRyotViewport();
	const summary = useRyotQuery(summaryQuery, input);
	const records = useReportedPages(recordsQuery, input);
	const items = paginationItems(
		records.pages,
		(page) => page.items,
		(item) => item.id,
	);
	return (
		<section aria-label="Collection reviews" className="flex min-w-0 flex-col gap-5">
			<QueryStatus query={summary} onRetry={summary.refetch} label="collection review totals">
				{(data) => {
					const { current, previous } = data.reporting.resolved;
					return (
						<ChartCard title="Reviews" description="Includes rating-only reviews">
							<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
								<p className="text-display font-semibold text-text tabular-nums">
									{formatMetric(data.current, reviewUnit)}
								</p>
								{previous === null ? null : (
									<DeltaBadge
										unit={reviewUnit}
										delta={metricDelta(data.current, data.previous)}
										comparisonLabel={`vs ${periodCaption(previous)}`}
									/>
								)}
							</div>
							<PeriodTrendChart
								unit={reviewUnit}
								compact={compact}
								timeZone={input.timeZone}
								current={reviewTrend(data)}
								label={periodCaption(current)}
								ariaLabel="Collection review trend"
								grouping={data.reporting.resolved.grouping}
							/>
						</ChartCard>
					);
				}}
			</QueryStatus>
			<ChartCard title="Recent reviews">
				<QueryStatus query={records} label="review records" onRetry={records.retry} />
				{records.data !== undefined && items.length === 0 ? (
					<EmptyState
						title="No reviews in this period"
						icon={<AppIcon size={18} name="star" />}
						description="Reviews and ratings you add to collected items appear here."
					/>
				) : (
					<ul className="flex flex-col divide-y divide-border">
						{items.map((review) => (
							<li key={review.id} className="flex min-w-0 items-center gap-3 py-2.5">
								<div className="min-w-0 flex-1">
									<PluginLink
										to={{ kind: "entity", entityId: review.entityId }}
										className="block truncate text-body font-medium text-text hover:underline"
									>
										{review.name}
									</PluginLink>
									<time dateTime={review.occurredAt} className="text-label text-text-muted">
										{formatReportingDateTime(review.occurredAt, input.timeZone)}
									</time>
								</div>
								{review.rating === null ? null : (
									<Badge variant="accent" aria-label={`Rating: ${review.rating}/100`}>
										{review.rating}/100
									</Badge>
								)}
							</li>
						))}
					</ul>
				)}
				{records.hasNextPage && !records.isError && (
					<LoadMoreButton
						label="Load more reviews"
						disabled={records.isFetching}
						onClick={records.fetchNextPage}
						isFetchingNextPage={records.isFetchingNextPage}
					/>
				)}
			</ChartCard>
		</section>
	);
}
