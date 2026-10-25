import type {
	ReportingPeriod,
	ResolvedReportingSelection,
} from "@ryot-app/contract/modules/analytics/reporting";
import { EntityId, EventId } from "@ryot-app/contract/schema/brands";
import {
	and,
	castDate,
	column,
	dateBucket,
	defineRecipe,
	eq,
	eventSchemaPredicate,
	groupAscending,
	gte,
	join,
	jsonPath,
	literal,
	lt,
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
			and(
				scope,
				...(period === null
					? []
					: [
							gte(occurredAt, castDate(literal(period.startAt))),
							lt(occurredAt, castDate(literal(period.endAt))),
						]),
			);
		return {
			map: ({ current, buckets, previous }) =>
				Result.succeed({
					buckets,
					current: current.count,
					previous: input.reporting.previous === null ? null : previous.count,
				}),
			queries: {
				current: selectedAggregate(review, {
					joins,
					measures,
					where: inPeriod(input.reporting.current),
				}),
				previous: selectedAggregate(review, {
					joins,
					measures,
					where:
						input.reporting.previous === null
							? and(scope, eq(literal(false), literal(true)))
							: inPeriod(input.reporting.previous),
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
						...(input.period === null
							? []
							: [
									gte(occurredAt, castDate(literal(input.period.startAt))),
									lt(occurredAt, castDate(literal(input.period.endAt))),
								]),
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
