import { column, literal, table } from "@ryot/ryotql";
import { Result } from "effect";
import { assert, describe, expect, it } from "vitest";

import { eventHistoryRecipe, eventIsAfter, eventOrderDescending, latestEventField } from "./events";
import { rowsResponse } from "./test-utils";

const pageInfo = { hasMore: false, limit: 25, nextCursor: null };
const event = {
	id: "event-1",
	entityId: "entity-1",
	entitySchemaSlug: "book",
	eventSchemaSlug: "review",
	sessionEntityId: null,
	properties: { rating: 5 },
	createdAt: "2026-01-01T01:00:00+02:00",
	updatedAt: "2026-01-02T01:00:00+02:00",
	occurredAt: "2026-01-03T01:00:00+02:00",
};

const recipe = eventHistoryRecipe({
	limit: 25,
	entityId: "entity-1",
	entitySchemaSlugs: ["book", "movie"],
	eventSchemaSlugs: ["review", "progress"],
});

const responseWithItems = (items: readonly unknown[]) => rowsResponse("events", items, pageInfo);

describe("event recipes", () => {
	it("uses the chronological total order for event expressions", () => {
		const current = table("event", "current");
		const boundary = table("event", "boundary");

		expect(eventOrderDescending(current)).toEqual([
			{ direction: "desc", expr: column(current, "occurredAt") },
			{ direction: "desc", expr: column(current, "createdAt") },
			{ direction: "desc", expr: column(current, "id") },
		]);
		expect(eventIsAfter(current, boundary)).toEqual({
			type: "or",
			predicates: [
				{
					operator: "gt",
					type: "comparison",
					left: column(current, "occurredAt"),
					right: column(boundary, "occurredAt"),
				},
				{
					type: "and",
					predicates: [
						{
							operator: "eq",
							type: "comparison",
							left: column(current, "occurredAt"),
							right: column(boundary, "occurredAt"),
						},
						{
							operator: "gt",
							type: "comparison",
							left: column(current, "createdAt"),
							right: column(boundary, "createdAt"),
						},
					],
				},
				{
					type: "and",
					predicates: [
						{
							operator: "eq",
							type: "comparison",
							left: column(current, "occurredAt"),
							right: column(boundary, "occurredAt"),
						},
						{
							operator: "eq",
							type: "comparison",
							left: column(current, "createdAt"),
							right: column(boundary, "createdAt"),
						},
						{
							operator: "gt",
							type: "comparison",
							left: column(current, "id"),
							right: column(boundary, "id"),
						},
					],
				},
			],
		});
	});

	it("builds latest fields with the standard event order", () => {
		const source = table("event", "source");
		const expression = latestEventField(source, {
			select: column(source, "eventSchemaSlug"),
			where: eventIsAfter(source, {
				id: literal("event-1"),
				createdAt: literal("2026-01-01T00:00:00.000Z"),
				occurredAt: literal("2026-01-01T00:00:00.000Z"),
			}),
		});

		expect(expression).toMatchObject({
			type: "first",
			select: { field: "eventSchemaSlug", tableAlias: "source" },
			orderBy: [
				{ direction: "desc", expr: { field: "occurredAt", tableAlias: "source" } },
				{ direction: "desc", expr: { field: "createdAt", tableAlias: "source" } },
				{ direction: "desc", expr: { field: "id", tableAlias: "source" } },
			],
		});
	});

	it("prepares the joined history query and decodes plain event values", () => {
		const query = recipe.document.queries.events;
		assert(query);
		assert(query.output.type === "rows");

		expect(query.joins).toHaveLength(1);
		expect(query.output.pagination).toEqual({ limit: 25 });
		expect(
			query.output.fields.map((selection) => ("key" in selection ? selection.key : null)),
		).toEqual([
			"id",
			"entityId",
			"createdAt",
			"updatedAt",
			"occurredAt",
			"properties",
			"eventSchemaSlug",
			"sessionEntityId",
			"entitySchemaSlug",
		]);
		expect(query.where).toMatchObject({
			type: "and",
			predicates: [
				{ type: "in", expr: { field: "eventSchemaSlug" } },
				{ type: "in", expr: { field: "entitySchemaSlug" } },
				{ left: { field: "entityId" }, right: { value: "entity-1" } },
			],
		});
		expect(Result.getOrThrow(recipe.decode(responseWithItems([event])))).toEqual({
			pageInfo,
			items: [
				{
					...event,
					createdAt: "2025-12-31T23:00:00.000Z",
					updatedAt: "2026-01-01T23:00:00.000Z",
					occurredAt: "2026-01-02T23:00:00.000Z",
				},
			],
		});
	});

	it("rejects malformed fields and non-rows results", () => {
		expect(
			Result.isFailure(recipe.decode(responseWithItems([{ ...event, occurredAt: "not-a-date" }]))),
		).toBe(true);
		expect(
			Result.isFailure(recipe.decode({ data: { events: { items: [], type: "aggregate" } } })),
		).toBe(true);
	});
});
