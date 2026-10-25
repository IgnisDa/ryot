import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	addCalendarUnits,
	type CalendarUnit,
	localDateOf,
	PluginLink,
	type ReportingPeriod,
	type ReportingSelection,
	type ResolvedReportingSelection,
	resolveReportingSelection,
	startOfCalendarUnit,
	type TimeZone,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, LoadMoreButton, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { PeriodTrendChart } from "@ryot-app/plugin-ui-sdk/charts";
import { DataTable } from "@ryot-app/plugin-ui-sdk/table";
import {
	COLLECTION_REVIEW_BUCKET_LIMIT,
	type CollectionReviewAnalytics,
	collectionReviewAnalyticsRecipe,
	type CollectionReviewRecords,
	collectionReviewRecordsRecipe,
} from "@ryot-app/ryotql-recipes/collection-analytics";

type TrendBucket = { readonly at: string; readonly value: null | number };
type Selection = { readonly timeZone: TimeZone; readonly selection: ReportingSelection };
type RecordsPage = CollectionReviewRecords & { readonly period: null | ReportingPeriod };

type RecordsCursor = { readonly after: string; readonly period: null | ReportingPeriod };
type Summary = {
	readonly counts: CollectionReviewAnalytics;
	readonly reporting: ResolvedReportingSelection;
};
type ReviewTrend = {
	readonly tooWide: boolean;
	readonly truncated: boolean;
	readonly buckets: ReadonlyArray<TrendBucket>;
};

const reviewTrend = (
	buckets: CollectionReviewAnalytics["buckets"],
	current: null | ReportingPeriod,
	grouping: CalendarUnit,
	timeZone: TimeZone,
): ReviewTrend => {
	const truncated = buckets.pageInfo?.hasMore ?? false;
	const complete = buckets.pageInfo?.hasMore === false;
	if (current === null) {
		return {
			truncated,
			tooWide: false,
			buckets: buckets.items.map((bucket) => ({ at: bucket.at, value: bucket.count })),
		};
	}

	const counts = new Map<string, number>();
	for (const bucket of buckets.items) {
		const date = localDateOf(bucket.at, timeZone);
		const at = startOfCalendarUnit(date, grouping);
		counts.set(at, (counts.get(at) ?? 0) + bucket.count);
	}

	const limit = buckets.pageInfo?.limit ?? COLLECTION_REVIEW_BUCKET_LIMIT;
	const calendar: string[] = [];
	let at = startOfCalendarUnit(current.startDate, grouping);
	while (at <= current.endDate) {
		if (calendar.length === limit) {
			return {
				truncated,
				tooWide: true,
				buckets: [...counts]
					.sort(([left], [right]) => left.localeCompare(right))
					.slice(0, limit)
					.map(([date, value]) => ({ value, at: date })),
			};
		}
		calendar.push(at);
		at = addCalendarUnits(at, grouping, 1);
	}

	return {
		truncated,
		tooWide: false,
		buckets: calendar.map((date) => ({
			at: date,
			value: counts.get(date) ?? (complete ? 0 : null),
		})),
	};
};

const summaryQuery = createRyotQuery<Selection, Summary>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const reporting = resolveReportingSelection(input.selection, {
				now: schedule.now(),
				timeZone: input.timeZone,
			});
			const counts = yield* client.data.query(collectionReviewAnalyticsRecipe({ reporting }));
			return { counts, reporting };
		}),
	{ cancelOnUnmount: true },
);

const recordsQuery = createRyotQuery<
	Selection & { readonly cursor: null | RecordsCursor },
	RecordsPage
>(
	({ input, client, schedule }) =>
		Effect.gen(function* () {
			const period =
				input.cursor === null
					? resolveReportingSelection(input.selection, {
							now: schedule.now(),
							timeZone: input.timeZone,
						}).current
					: input.cursor.period;
			const records = yield* client.data.query(
				collectionReviewRecordsRecipe({
					period,
					...(input.cursor === null ? {} : { after: input.cursor.after }),
				}),
			);
			return { ...records, period };
		}),
	{ cancelOnUnmount: true },
);

const periodLabel = (period: null | ReportingPeriod) =>
	period === null ? "All time" : `${period.startDate} – ${period.endDate}`;

export function CollectionAnalytics(input: Selection) {
	const { compact } = useRyotViewport();
	const summary = useRyotQuery(summaryQuery, input);
	const records = useRyotInfiniteQuery(recordsQuery, input, {
		initialPageParam: null,
		getPageInput: (selection, cursor: null | RecordsCursor) => ({ ...selection, cursor }),
		getNextPageParam: (page) => {
			const after = nextPageCursor(page);
			return after === null ? null : { after, period: page.period };
		},
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
	const trend =
		summary.data === undefined
			? null
			: reviewTrend(
					summary.data.counts.buckets,
					summary.data.reporting.current,
					summary.data.reporting.grouping,
					input.timeZone,
				);
	return (
		<section aria-label="Collection reviews" className="flex flex-col gap-4">
			<h2 className="text-lg font-semibold">Collection reviews</h2>
			<p className="text-sm text-text-muted">Includes rating-only reviews · {input.timeZone}</p>
			{summary.isError && (
				<StatusMessage tone="error">
					Could not load collection review totals.{" "}
					<Button variant="link" onClick={summary.refetch}>
						Retry totals
					</Button>
				</StatusMessage>
			)}
			{summary.data === undefined ? (
				!summary.isError && (
					<StatusMessage tone="pending">Loading collection review totals...</StatusMessage>
				)
			) : (
				<>
					<dl className="flex flex-wrap gap-6">
						<div>
							<dt>Current · {periodLabel(summary.data.reporting.current)}</dt>
							<dd>{summary.data.counts.current} reviews</dd>
						</div>
						{summary.data.reporting.previous !== null && (
							<div>
								<dt>Previous · {periodLabel(summary.data.reporting.previous)}</dt>
								<dd>{summary.data.counts.previous} reviews</dd>
							</div>
						)}
					</dl>
					{trend?.tooWide && (
						<DataTable
							data={trend.buckets}
							getRowId={(bucket) => bucket.at}
							rowClassName="border-b border-border"
							className="w-full table-fixed text-left text-sm"
							aria-label="Collection review trend returned buckets"
							columns={[
								{
									id: "date",
									header: "Bucket date",
									cell: (bucket) => bucket.at,
									cellClassName: "py-2 pr-3 break-words",
								},
								{
									id: "count",
									header: "Reviews",
									headerClassName: "text-right",
									cell: (bucket) => bucket.value,
									cellClassName: "py-2 text-right tabular-nums break-words",
								},
							]}
						/>
					)}
					{trend !== null && !trend.tooWide && (
						<PeriodTrendChart
							compact={compact}
							buckets={trend.buckets}
							timeZone={input.timeZone}
							ariaLabel="Collection review trend"
							formatValue={(value) => `${value} reviews`}
							label={`Collection reviews · ${periodLabel(summary.data.reporting.current)}`}
						/>
					)}
					{trend?.truncated && (
						<StatusMessage tone="pending">
							Trend is truncated. Choose a shorter range or a coarser grouping. Totals include all
							reviews.
						</StatusMessage>
					)}
					{trend?.tooWide && (
						<StatusMessage tone="pending">
							Trend has too many calendar buckets to chart. Choose a shorter range or a coarser
							grouping. Totals include all reviews.
						</StatusMessage>
					)}
				</>
			)}
			<h3 className="font-semibold">Review records</h3>
			{records.data !== undefined && (
				<p className="text-sm text-text-muted">{periodLabel(records.data.period)}</p>
			)}
			{records.isError && (
				<StatusMessage tone="error">
					Could not load review records.{" "}
					<Button variant="link" onClick={records.retry}>
						Retry records
					</Button>
				</StatusMessage>
			)}
			{records.data === undefined && !records.isError && (
				<StatusMessage tone="pending">Loading review records...</StatusMessage>
			)}
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
