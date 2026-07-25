import { describe, expect, it } from "vitest";

import { ascending, column, document, eq, field, literal, rows, table } from "./index";

describe("RyotQL builders", () => {
	it("builds serializable named rows with defaults and omitted optional fields", () => {
		const entity = table("entity", "entity");

		expect(
			document({ entities: rows(entity, { fields: [field("id", column(entity, "id"))] }) }),
		).toEqual({
			queries: {
				entities: {
					from: { table: "entity", alias: "entity" },
					output: {
						type: "rows",
						pagination: { page: 1, limit: 20 },
						fields: [{ key: "id", expr: { type: "column", tableAlias: "entity", field: "id" } }],
						orderBy: [
							{ direction: "asc", expr: { type: "column", tableAlias: "entity", field: "id" } },
						],
					},
				},
			},
		});
	});

	it("preserves table aliases in expressions and explicit rows options", () => {
		const entity = table("entity", "collection");
		const query = rows(entity, {
			page: 2,
			limit: 7,
			orderBy: [ascending(column(entity, "name"))],
			fields: [field("name", column(entity, "name"))],
			where: eq(column(entity, "entitySchemaSlug"), literal("collection")),
		});

		expect(query).toMatchObject({
			output: { pagination: { page: 2, limit: 7 } },
			where: { left: { tableAlias: "collection" }, right: { value: "collection" } },
		});
	});
});
