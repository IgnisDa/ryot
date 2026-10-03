import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	notificationSubscriptionRecipe,
	notificationSubscriptionsRecipe,
} from "./notification-subscriptions";
import { requireRowsQuery, rowsResult } from "./test-utils";

const item = {
	id: "rule-1",
	isActive: true,
	signalSchemaSlug: "review.created",
	createdAt: "2026-01-01T01:00:00+02:00",
	updatedAt: "2026-01-02T01:00:00+02:00",
};
const pageInfo = { limit: 2, hasMore: true, nextCursor: "next" };
const rows = (items: readonly unknown[], limit = 2) => rowsResult(items, { ...pageInfo, limit });

describe("notification subscription recipes", () => {
	it("prepares the paginated list with exact fields and ordering", () => {
		const query = requireRowsQuery(
			notificationSubscriptionsRecipe({ limit: 7, after: "cursor" }).document.queries
				.notificationSubscriptions,
		);

		expect(query.from).toEqual({
			table: "notificationSubscription",
			alias: "notificationSubscription",
		});
		expect(query.output.pagination).toEqual({ limit: 7, after: "cursor" });
		expect(query.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"isActive",
			"createdAt",
			"updatedAt",
			"signalSchemaSlug",
		]);
		expect(query.output.orderBy).toEqual([
			{
				direction: "asc",
				expr: { type: "column", field: "signalSchemaSlug", tableAlias: "notificationSubscription" },
			},
			{
				direction: "asc",
				expr: { field: "id", type: "column", tableAlias: "notificationSubscription" },
			},
		]);
	});

	it("prepares optional by-id detail with cardinality limit two", () => {
		const query = requireRowsQuery(
			notificationSubscriptionRecipe({ id: "rule-1" }).document.queries.notificationSubscription,
		);

		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(query.where).toMatchObject({ left: { field: "id" }, right: { value: "rule-1" } });
	});

	it("decodes plain branded values, page info, and normalized dates", () => {
		expect(
			Result.getOrThrow(
				notificationSubscriptionsRecipe({ limit: 2 }).decode({
					data: { notificationSubscriptions: rows([item]) },
				}),
			),
		).toEqual({
			pageInfo,
			items: [
				{ ...item, createdAt: "2025-12-31T23:00:00.000Z", updatedAt: "2026-01-01T23:00:00.000Z" },
			],
		});
	});

	it("decodes optional detail and rejects excess cardinality", () => {
		const recipe = notificationSubscriptionRecipe({ id: "rule-1" });

		expect(
			Result.getOrThrow(recipe.decode({ data: { notificationSubscription: rows([], 2) } })),
		).toBeUndefined();
		expect(
			Result.isFailure(
				recipe.decode({ data: { notificationSubscription: rows([item, item], 2) } }),
			),
		).toBe(true);
	});

	it("rejects malformed fields, dates, and result shapes", () => {
		const recipe = notificationSubscriptionsRecipe({ limit: 2 });

		for (const malformed of [
			{ ...item, isActive: "true" },
			{ ...item, createdAt: "not-a-date" },
			{ ...item, updatedAt: "not-a-date" },
		]) {
			expect(
				Result.isFailure(recipe.decode({ data: { notificationSubscriptions: rows([malformed]) } })),
			).toBe(true);
		}
		expect(Result.isFailure(recipe.decode({ data: {} }))).toBe(true);
	});
});
