import type { ResolvedReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import { Result } from "effect";
import { assert, describe, expect, it } from "vitest";

import {
	collectionReviewAnalyticsRecipe,
	collectionReviewRecordsRecipe,
} from "./collection-analytics";

const reporting: ResolvedReportingSelection = {
	grouping: "day",
	timeZone: "America/New_York",
	current: {
		endDate: "2026-03-08",
		startDate: "2026-03-08",
		endAt: "2026-03-09T04:00:00.000Z",
		startAt: "2026-03-08T05:00:00.000Z",
	},
	previous: {
		endDate: "2026-03-07",
		startDate: "2026-03-07",
		endAt: "2026-03-08T05:00:00.000Z",
		startAt: "2026-03-07T05:00:00.000Z",
	},
};

describe("collection review analytics", () => {
	it("pages contributing records with the same ownership and half-open period as totals", () => {
		const recipe = collectionReviewRecordsRecipe({
			after: "real-cursor",
			period: reporting.current,
		});
		const query = recipe.document.queries.reviews;
		expect(query?.where).toEqual(
			collectionReviewAnalyticsRecipe({ reporting }).document.queries.current?.where,
		);
		expect(query?.output).toMatchObject({
			type: "rows",
			pagination: { after: "real-cursor" },
			orderBy: [
				{ direction: "desc", expr: { field: "occurredAt" } },
				{ direction: "desc", expr: { field: "createdAt" } },
				{ direction: "desc", expr: { field: "id" } },
			],
		});
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						reviews: {
							type: "rows",
							pageInfo: { limit: 100, hasMore: true, nextCursor: "continuation" },
							items: [
								{
									rating: 0,
									id: "review-1",
									name: "Archive",
									entityId: "collection-1",
									occurredAt: "2026-03-08T05:00:00.000Z",
								},
							],
						},
					},
				}),
			),
		).toEqual({
			pageInfo: { limit: 100, hasMore: true, nextCursor: "continuation" },
			items: [
				{
					rating: 0,
					id: "review-1",
					name: "Archive",
					entityId: "collection-1",
					occurredAt: "2026-03-08T05:00:00.000Z",
				},
			],
		});
		expect(
			collectionReviewRecordsRecipe({ period: null }).document.queries.reviews?.where,
		).toMatchObject({ predicates: [expect.objectContaining({ type: "and" })] });
	});
	it("counts every kernel collection review, including rating-only records, with both owners scoped", () => {
		const recipe = collectionReviewAnalyticsRecipe({ reporting });
		for (const query of Object.values(recipe.document.queries)) {
			expect(query.from).toMatchObject({ table: "event" });
			expect(query.joins).toMatchObject([{ type: "inner", table: { table: "entity" } }]);
			expect(query.output).toMatchObject({
				measures: [{ key: "count", aggregation: { function: "count" } }],
			});
			expect(query.where).toMatchObject({
				predicates: expect.arrayContaining([
					expect.objectContaining({
						predicates: [
							{
								operator: "eq",
								type: "comparison",
								right: { field: "id", type: "column", tableAlias: "reviewedCollection" },
								left: { type: "column", field: "entityId", tableAlias: "collectionReview" },
							},
							{
								operator: "eq",
								type: "comparison",
								right: { type: "literal", value: "review" },
								left: { type: "column", field: "eventSchemaSlug", tableAlias: "collectionReview" },
							},
							{
								type: "isNull",
								expr: {
									type: "column",
									field: "eventSchemaPluginId",
									tableAlias: "collectionReview",
								},
							},
							{
								type: "and",
								predicates: [
									{
										operator: "eq",
										type: "comparison",
										right: { type: "literal", value: "collection" },
										left: {
											type: "column",
											field: "entitySchemaSlug",
											tableAlias: "reviewedCollection",
										},
									},
									{
										type: "isNull",
										expr: {
											type: "column",
											field: "entitySchemaPluginId",
											tableAlias: "reviewedCollection",
										},
									},
								],
							},
						],
					}),
				]),
			});
			expect(JSON.stringify(query.where)).not.toContain('"properties"');
		}
	});

	it("uses caller-supplied half-open periods and timezone-aware groups across DST", () => {
		const { current, buckets, previous } = collectionReviewAnalyticsRecipe({
			reporting,
			bucketLimit: 20,
		}).document.queries;
		expect(current?.where).toMatchObject({
			predicates: [
				{},
				{
					operator: "gte",
					left: { field: "occurredAt" },
					right: { type: "cast", target: "date", expr: { value: "2026-03-08T05:00:00.000Z" } },
				},
				{
					operator: "lt",
					left: { field: "occurredAt" },
					right: { type: "cast", target: "date", expr: { value: "2026-03-09T04:00:00.000Z" } },
				},
			],
		});
		expect(previous?.where).toMatchObject({
			predicates: [
				{},
				{ operator: "gte", right: { expr: { value: "2026-03-07T05:00:00.000Z" } } },
				{ operator: "lt", right: { expr: { value: "2026-03-08T05:00:00.000Z" } } },
			],
		});
		expect(buckets?.where).toEqual(current?.where);
		expect(buckets?.output).toMatchObject({
			limit: 20,
			orderBy: [{ key: "at", direction: "asc" }],
			groupBy: [
				{
					key: "at",
					expr: {
						bucket: "day",
						type: "dateBucket",
						timeZone: "America/New_York",
						expr: { field: "occurredAt" },
					},
				},
			],
		});
	});

	it("returns complete totals independently of bounded bucket results and preserves truncation", () => {
		const recipe = collectionReviewAnalyticsRecipe({ reporting, bucketLimit: 1 });
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						current: { type: "aggregate", items: [{ count: 42 }] },
						previous: { type: "aggregate", items: [{ count: 0 }] },
						buckets: {
							type: "aggregate",
							pageInfo: { limit: 1, hasMore: true },
							items: [{ count: 2, at: "2026-03-08T05:00:00.000Z" }],
						},
					},
				}),
			),
		).toEqual({
			current: 42,
			previous: 0,
			buckets: {
				pageInfo: { limit: 1, hasMore: true },
				items: [{ count: 2, at: "2026-03-08T05:00:00.000Z" }],
			},
		});
	});

	it("keeps all-time unbounded and no comparison distinct from zero", () => {
		const recipe = collectionReviewAnalyticsRecipe({
			reporting: { ...reporting, current: null, previous: null, grouping: "year" },
		});
		const query = recipe.document.queries.current;
		assert(query?.where?.type === "and");
		expect(query.where.predicates).toHaveLength(1);
		expect(recipe.document.queries.buckets?.output).toMatchObject({
			groupBy: [{ expr: { bucket: "year" } }],
		});
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						current: { type: "aggregate", items: [{ count: 0 }] },
						previous: { type: "aggregate", items: [{ count: 0 }] },
						buckets: { items: [], type: "aggregate", pageInfo: { limit: 1000, hasMore: false } },
					},
				}),
			),
		).toEqual({
			current: 0,
			previous: null,
			buckets: { items: [], pageInfo: { limit: 1000, hasMore: false } },
		});
	});
});
