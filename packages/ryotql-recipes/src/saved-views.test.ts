import { column, field, literal, table } from "@ryot/ryotql";
import { describe, expect, it } from "vitest";

import { buildSavedViewDocument, buildSavedViewLayoutProjections } from "./saved-views";

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
		const projections = buildSavedViewLayoutProjections({
			table: {
				entityId: literal("table id"),
				image: literal("table image"),
				columns: [
					{ label: "Name", expression: literal("name") },
					{ label: "Year", expression: literal(2026) },
				],
			},
			grid: {
				entityId: literal("grid id"),
				card: {
					image: null,
					callout: null,
					secondaryMetadata: null,
					overline: literal("Grid"),
					title: literal("grid title"),
					primaryMetadata: literal("Primary"),
				},
			},
			list: {
				entityId: literal("list id"),
				card: {
					overline: null,
					primaryMetadata: null,
					image: literal("image"),
					callout: literal("Callout"),
					title: literal("list title"),
					secondaryMetadata: literal("Secondary"),
				},
			},
		});

		expect(projections.grid.fields.map(({ key }) => key)).toEqual([
			"entityId",
			"title",
			"overline",
			"primaryMetadata",
		]);
		expect(projections.list.fields.map(({ key }) => key)).toEqual([
			"entityId",
			"title",
			"image",
			"callout",
			"secondaryMetadata",
		]);
		expect(projections.table.fields.map(({ key }) => key)).toEqual([
			"entityId",
			"image",
			"column0",
			"column1",
		]);
		expect(projections).toMatchObject({
			table: {
				mappings: {
					imageField: "image",
					entityIdField: "entityId",
					columns: [
						{ label: "Name", field: "column0" },
						{ label: "Year", field: "column1" },
					],
				},
			},
			grid: {
				mappings: {
					imageField: null,
					calloutField: null,
					titleField: "title",
					entityIdField: "entityId",
					overlineField: "overline",
					secondaryMetadataField: null,
					primaryMetadataField: "primaryMetadata",
				},
			},
			list: {
				mappings: {
					imageField: "image",
					titleField: "title",
					overlineField: null,
					calloutField: "callout",
					entityIdField: "entityId",
					primaryMetadataField: null,
					secondaryMetadataField: "secondaryMetadata",
				},
			},
		});
	});
});
