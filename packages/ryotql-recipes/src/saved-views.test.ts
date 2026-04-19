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
			table: [{ label: "Name", expression: literal("name") }],
			grid: {
				image: null,
				callout: null,
				secondarySubtitle: null,
				eyebrow: literal("Grid"),
				title: literal("grid title"),
				primarySubtitle: literal("Primary"),
			},
			list: {
				eyebrow: null,
				primarySubtitle: null,
				image: literal("image"),
				callout: literal("Callout"),
				title: literal("list title"),
				secondarySubtitle: literal("Secondary"),
			},
		});

		expect(projection.fields.map(({ key }) => key)).toEqual([
			"entityId",
			"gridTitle",
			"gridEyebrow",
			"gridPrimarySubtitle",
			"listTitle",
			"listImage",
			"listCallout",
			"listSecondarySubtitle",
			"tableColumn0",
		]);
		expect(projection.displayConfiguration).toEqual({
			entityIdField: "entityId",
			table: { columns: [{ label: "Name", field: "tableColumn0" }] },
			grid: {
				imageField: null,
				calloutField: null,
				titleField: "gridTitle",
				eyebrowField: "gridEyebrow",
				secondarySubtitleField: null,
				primarySubtitleField: "gridPrimarySubtitle",
			},
			list: {
				eyebrowField: null,
				imageField: "listImage",
				titleField: "listTitle",
				primarySubtitleField: null,
				calloutField: "listCallout",
				secondarySubtitleField: "listSecondarySubtitle",
			},
		});
	});
});
