import {
	aggregate,
	ascending,
	column,
	document,
	eq,
	field,
	include,
	join,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	buildSavedViewCountDocument,
	buildSavedViewDocument,
	buildSavedViewLayoutProjections,
	decodeSavedViewCountResponse,
} from "./saved-views";

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

	it("builds a count document from the first rows query", () => {
		const entity = table("entity", "entity");
		const relatedEntity = table("entity", "relatedEntity");
		const where = eq(column(entity, "status"), literal("active"));
		const joins = [
			join("inner", relatedEntity, eq(column(entity, "id"), column(relatedEntity, "id"))),
		];
		const source = document({
			savedView: rows(entity, {
				where,
				joins,
				limit: 25,
				after: "cursor",
				orderBy: [ascending(column(entity, "name"))],
				fields: [field("id", column(entity, "id")), field("name", column(entity, "name"))],
				include: [
					include(relatedEntity, {
						limit: 1,
						key: "related",
						fields: [field("id", column(relatedEntity, "id"))],
						orderBy: [ascending(column(relatedEntity, "id"))],
					}),
				],
			}),
		});

		expect(buildSavedViewCountDocument(source)).toEqual({
			queries: {
				savedViewCount: {
					where,
					joins,
					from: entity,
					output: {
						type: "aggregate",
						measures: [{ key: "total", aggregation: { function: "count" } }],
					},
				},
			},
		});
	});

	it("returns null when the source document has no rows query", () => {
		const entity = table("entity", "entity");

		expect(buildSavedViewCountDocument(document({}))).toBeNull();
		expect(
			buildSavedViewCountDocument(
				document({
					savedView: aggregate(entity, {
						measures: [{ key: "total", aggregation: { function: "count" } }],
					}),
				}),
			),
		).toBeNull();
	});

	it("decodes an ungrouped count response", () => {
		expect(
			Result.getOrThrow(
				decodeSavedViewCountResponse({
					data: {
						savedViewCount: {
							type: "aggregate",
							items: [{ total: { kind: "number", value: 42 } }],
						},
					},
				}),
			),
		).toBe(42);
	});

	it("fails to decode a count response with no items", () => {
		expect(
			Result.isFailure(
				decodeSavedViewCountResponse({
					data: { savedViewCount: { type: "aggregate", items: [] } },
				}),
			),
		).toBe(true);
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
