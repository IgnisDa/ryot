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
import { LoadMoreButton, QueryStatus, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { formatReportingDateTime, PeriodTrendChart } from "@ryot-app/plugin-ui-sdk/charts";
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

const formatReviews = (value: number) => `${value} reviews`;

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
		<section aria-label="Collection reviews" className="flex flex-col gap-4">
			<h2 className="text-lg font-semibold">Collection reviews</h2>
			<p className="text-sm text-text-muted">Includes rating-only reviews · {input.timeZone}</p>
			<QueryStatus query={summary} onRetry={summary.refetch} label="collection review totals">
				{(data) => (
					<>
						<dl className="flex flex-wrap gap-6">
							<div>
								<dt>Current · {periodCaption(data.reporting.resolved.current)}</dt>
								<dd>{data.current} reviews</dd>
							</div>
							{data.reporting.resolved.previous !== null && (
								<div>
									<dt>Previous · {periodCaption(data.reporting.resolved.previous)}</dt>
									<dd>{data.previous} reviews</dd>
								</div>
							)}
						</dl>
						<PeriodTrendChart
							compact={compact}
							timeZone={input.timeZone}
							current={reviewTrend(data)}
							formatValue={formatReviews}
							ariaLabel="Collection review trend"
							label={`Collection reviews · ${periodCaption(data.reporting.resolved.current)}`}
						/>
					</>
				)}
			</QueryStatus>
			<h3 className="font-semibold">Review records</h3>
			<QueryStatus query={records} label="review records" onRetry={records.retry}>
				{(data) => (
					<p className="text-sm text-text-muted">
						{periodCaption(data.reporting.resolved.current)}
					</p>
				)}
			</QueryStatus>
			{records.data !== undefined && items.length === 0 && (
				<StatusMessage tone="pending">No collection reviews in this period.</StatusMessage>
			)}
			<ul className="flex flex-col gap-3">
				{items.map((review) => (
					<li key={review.id} className="flex flex-wrap items-baseline gap-2">
						<PluginLink to={{ kind: "entity", entityId: review.entityId }}>
							{review.name}
						</PluginLink>
						<time dateTime={review.occurredAt}>
							{formatReportingDateTime(review.occurredAt, input.timeZone)}
						</time>
						{review.rating !== null && <span>Rating: {review.rating}/100</span>}
					</li>
				))}
			</ul>
			{records.hasNextPage && !records.isError && (
				<LoadMoreButton
					label="Load more reviews"
					disabled={records.isFetching}
					onClick={records.fetchNextPage}
					isFetchingNextPage={records.isFetchingNextPage}
				/>
			)}
		</section>
	);
}
