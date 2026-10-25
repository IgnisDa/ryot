import type {
	ReportingPeriod,
	ResolvedReportingSelection,
} from "@ryot-app/contract/modules/analytics/reporting";
import { EntityId, EventId } from "@ryot-app/contract/schema/brands";
import {
	and,
	column,
	dateBucket,
	defineRecipe,
	eq,
	eventSchemaPredicate,
	groupAscending,
	join,
	jsonPath,
	type Recipe,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";
import { eventOrderDescending } from "./event-expressions";
import { withinPeriod } from "./periods";

export const COLLECTION_REVIEW_BUCKET_LIMIT = 1000;

export const collectionReviewAnalyticsRecipe = defineRecipe(
	(input: { readonly reporting: ResolvedReportingSelection }) => {
		const review = table("event", "collectionReview");
		const collection = table("entity", "reviewedCollection");
		const occurredAt = column(review, "occurredAt");
		const scope = eventSchemaPredicate(review, collection, "collection", "review", {
			kind: "kernel",
		});
		const joins = [
			join("inner", collection, eq(column(review, "entityId"), column(collection, "id"))),
		];
		const measures = { count: selectedMeasure({ function: "count" }, Schema.Finite) };
		const inPeriod = (period: null | ReportingPeriod) =>
			and(scope, withinPeriod(occurredAt, period));
		return {
			map: ({ current, buckets, previous }) =>
				Result.succeed({ buckets, current: current.count, previous: previous?.count ?? null }),
			queries: {
				current: selectedAggregate(review, {
					joins,
					measures,
					where: inPeriod(input.reporting.current),
				}),
				previous:
					input.reporting.previous === null
						? undefined
						: selectedAggregate(review, {
								joins,
								measures,
								where: inPeriod(input.reporting.previous),
							}),
				buckets: selectedAggregate(review, {
					joins,
					measures,
					orderBy: [groupAscending("at")],
					limit: COLLECTION_REVIEW_BUCKET_LIMIT,
					where: inPeriod(input.reporting.current),
					groupBy: {
						at: selectedField(
							dateBucket(occurredAt, {
								bucket: input.reporting.grouping,
								timeZone: input.reporting.timeZone,
							}),
							IsoDateString,
						),
					},
				}),
			},
		};
	},
);

export type CollectionReviewAnalytics = Recipe.Success<typeof collectionReviewAnalyticsRecipe>;

export const collectionReviewRecordsRecipe = defineRecipe(
	(input: { readonly after?: string | undefined; readonly period: null | ReportingPeriod }) => {
		const review = table("event", "collectionReview");
		const collection = table("entity", "reviewedCollection");
		const occurredAt = column(review, "occurredAt");
		return {
			map: ({ reviews }) => Result.succeed(reviews),
			queries: {
				reviews: selectedRows(review, {
					after: input.after,
					orderBy: eventOrderDescending(review),
					joins: [
						join("inner", collection, eq(column(review, "entityId"), column(collection, "id"))),
					],
					where: and(
						eventSchemaPredicate(review, collection, "collection", "review", { kind: "kernel" }),
						withinPeriod(occurredAt, input.period),
					),
					selection: {
						id: selectedField(column(review, "id"), EventId),
						occurredAt: selectedField(occurredAt, IsoDateString),
						entityId: selectedField(column(collection, "id"), EntityId),
						name: selectedField(column(collection, "name"), Schema.String),
						rating: selectedField(
							jsonPath(column(review, "properties"), "rating"),
							Schema.NullOr(Schema.Finite),
						),
					},
				}),
			},
		};
	},
);

export type CollectionReviewRecords = Recipe.Success<typeof collectionReviewRecordsRecipe>;
