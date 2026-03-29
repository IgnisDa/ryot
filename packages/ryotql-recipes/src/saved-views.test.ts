import { column, field, literal, table } from "@ryot/ryotql";
import { describe, expect, it } from "vitest";

import { buildSavedViewDocument, buildSavedViewProjection } from "./saved-views";

describe("saved-view recipes", () => {
	it("uses a discriminator membership predicate for multiple entity schemas", () => {
		const entity = table("entity", "entity");
		const query = buildSavedViewDocument({
			entitySchemaSlugs: ["smartphone", "tablet"],
			fields: [field("id", column(entity, "id"))],
		});

		expect(query.queries.savedView.where).toMatchObject({
			type: "in",
			expr: { type: "column", field: "entitySchemaSlug", tableAlias: "entity" },
			values: [
				{ type: "literal", value: "smartphone" },
				{ type: "literal", value: "tablet" },
			],
		});
	});

	it("allocates stable keys across every saved-view layout", () => {
		const projection = buildSavedViewProjection({
			entityId: literal("id"),
			table: {
				image: literal("table image"),
				columns: [
					{ label: "Name", expression: literal("name") },
					{ label: "Year", expression: literal(2026) },
				],
			},
			grid: {
				image: null,
				callout: null,
				secondaryMetadata: null,
				overline: literal("Grid"),
				title: literal("grid title"),
				primaryMetadata: literal("Primary"),
			},
			list: {
				overline: null,
				primaryMetadata: null,
				image: literal("image"),
				callout: literal("Callout"),
				title: literal("list title"),
				secondaryMetadata: literal("Secondary"),
			},
		});

		expect(projection.fields.map(({ key }) => key)).toEqual([
			"entityId",
			"gridTitle",
			"gridOverline",
			"gridPrimaryMetadata",
			"listTitle",
			"listImage",
			"listCallout",
			"listSecondaryMetadata",
			"tableImage",
			"tableColumn0",
			"tableColumn1",
		]);
		expect(projection.displayConfiguration).toEqual({
			entityIdField: "entityId",
			table: {
				imageField: "tableImage",
				columns: [
					{ label: "Name", field: "tableColumn0" },
					{ label: "Year", field: "tableColumn1" },
				],
			},
			grid: {
				imageField: null,
				calloutField: null,
				titleField: "gridTitle",
				secondaryMetadataField: null,
				overlineField: "gridOverline",
				primaryMetadataField: "gridPrimaryMetadata",
			},
			list: {
				overlineField: null,
				imageField: "listImage",
				titleField: "listTitle",
				primaryMetadataField: null,
				calloutField: "listCallout",
				secondaryMetadataField: "listSecondaryMetadata",
			},
		});
	});
});
