import { describe, expect, it } from "vitest";

import { buildEventHistoryDocument } from "./events";

describe("event recipes", () => {
	it("builds the event history read with an ordinary entity join", () => {
		const query = buildEventHistoryDocument({
			page: 2,
			limit: 25,
			entityId: "entity-1",
			entitySchemaSlugs: ["book", "movie"],
			eventSchemaSlugs: ["review", "progress"],
		}).queries["events"];

		expect(query.from).toEqual({ table: "event", alias: "event" });
		expect(query.joins).toEqual([
			{
				type: "inner",
				table: { table: "entity", alias: "entity" },
				on: {
					operator: "eq",
					type: "comparison",
					right: { type: "column", tableAlias: "entity", field: "id" },
					left: { type: "column", tableAlias: "event", field: "entityId" },
				},
			},
		]);
		expect(query.output.pagination).toEqual({ page: 2, limit: 25 });
		expect(query.output.fields.map((selection) => selection.key)).toEqual([
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
				{ type: "comparison", left: { field: "entityId" }, right: { value: "entity-1" } },
			],
		});
	});
});
