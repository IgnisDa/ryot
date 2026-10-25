import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	calendarBuckets,
	periodCaption,
	PluginLink,
	type Reported,
	reportingExecution,
	type ReportingSelection,
	type TimeZone,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	paginationItems,
	type ReportingPageParam,
	reportingPageParam,
	useRyotInfiniteQuery,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { LoadMoreButton, QueryStatus, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { PeriodTrendChart } from "@ryot-app/plugin-ui-sdk/charts";
import {
	type CollectionReviewAnalytics,
	collectionReviewAnalyticsRecipe,
	type CollectionReviewRecords,
	collectionReviewRecordsRecipe,
} from "@ryot-app/ryotql-recipes/collection-analytics";

type Selection = { readonly timeZone: TimeZone; readonly selection: ReportingSelection };

const summaryQuery = createRyotQuery<Selection, Reported<CollectionReviewAnalytics>>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const reporting = reportingExecution(input.selection, {
				now: schedule.now(),
				timeZone: input.timeZone,
			});
			const counts = yield* client.data.query(
				collectionReviewAnalyticsRecipe({ reporting: reporting.resolved }),
			);
			return { ...counts, reporting };
		}),
	{ cancelOnUnmount: true },
);

const recordsQuery = createRyotQuery<
	Selection & { readonly page: ReportingPageParam },
	Reported<CollectionReviewRecords>
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const reporting = reportingExecution(input.page?.selection ?? input.selection, {
				now: schedule.now(),
				timeZone: input.timeZone,
			});
			const records = yield* client.data.query(
				collectionReviewRecordsRecipe({
					after: input.page?.after,
					period: reporting.resolved.current,
				}),
			);
			return { ...records, reporting };
		}),
	{ cancelOnUnmount: true },
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
	const records = useRyotInfiniteQuery(recordsQuery, input, {
		initialPageParam: null,
		getNextPageParam: reportingPageParam,
		getPageInput: (selection, page: ReportingPageParam) => ({ ...selection, page }),
	});
	const items = paginationItems(
		records.pages,
		(page) => page.items,
		(item) => item.id,
	);
	const formatDate = new Intl.DateTimeFormat(undefined, {
		timeStyle: "short",
		dateStyle: "medium",
		timeZone: input.timeZone,
	});
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
							{formatDate.format(new Date(review.occurredAt))}
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
