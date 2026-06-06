import { column, field, table } from "@ryot/ryotql";
import { describe, expect, it } from "vitest";

import { buildAllCollectionsDocument } from "./collections";

describe("collections recipe", () => {
	it("selects collection ids and names with stable requested pagination", () => {
		const collection = table("entity", "collection");
		expect(
			buildAllCollectionsDocument({
				page: 3,
				limit: 7,
				fields: [field("id", column(collection, "id")), field("name", column(collection, "name"))],
			}),
		).toMatchObject({
			queries: {
				collections: {
					from: { table: "entity", alias: "collection" },
					output: { pagination: { page: 3, limit: 7 }, fields: [{ key: "id" }, { key: "name" }] },
					where: {
						right: { type: "literal", value: "collection" },
						left: { field: "entitySchemaSlug", tableAlias: "collection" },
					},
				},
			},
		});
	});
});
