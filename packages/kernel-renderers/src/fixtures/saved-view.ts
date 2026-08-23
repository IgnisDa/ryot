import { ascending, column, document, field, jsonPath, rows, table } from "@ryot-app/ryotql";

const entity = table("entity", "entity");

export const browserDataSources = document({
	savedView: rows(entity, {
		limit: 2,
		orderBy: [ascending(column(entity, "name"))],
		fields: [
			field("entityId", column(entity, "id")),
			field("column0", column(entity, "name")),
			field("column1", jsonPath(column(entity, "properties"), "publishYear")),
			field("image", jsonPath(column(entity, "properties"), "images", 0)),
			field("ownerPluginId", column(entity, "entitySchemaPluginId")),
			field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
		],
	}),
});

export const browserSettings = {
	pageSize: 2,
	sortChoices: [],
	defaultLayout: "grid",
	sourceName: "savedView",
	searchFields: ["column0"],
	entityIdField: "entityId",
	layouts: ["grid", "list", "table"],
	ownerPluginIdField: "ownerPluginId",
	entitySchemaSlugField: "entitySchemaSlug",
	addAction: { type: "provider-search", ownerPluginId: "media", entitySchemaSlug: "book" },
	tableColumns: [
		{ label: "Image", field: "image", displayKind: "managed-asset" },
		{ label: "Name", field: "column0", displayKind: "text" },
		{ label: "Year", field: "column1", displayKind: "number" },
	],
};

export const browserRow = (entityId: string, name: string) => ({
	entityId,
	image: null,
	column0: name,
	column1: 2026,
	ownerPluginId: "media",
	entitySchemaSlug: "book",
	__entityBrowserName: name,
	__entityBrowserPopulationStatus: "ready",
	__entityBrowserTranslationStatus: "ready",
});

export const browserPage = (
	items: readonly Record<string, unknown>[],
	hasMore = false,
	nextCursor: string | null = null,
) => ({
	data: {
		entityBrowser: { items, type: "rows" as const, pageInfo: { limit: 2, hasMore, nextCursor } },
	},
});

const event = table("event", "event");

export const resultsDataSources = document({
	readingLog: rows(event, {
		limit: 10,
		orderBy: [ascending(column(event, "occurredAt"))],
		fields: [
			field("entityId", column(event, "entityId")),
			field("occurredAt", column(event, "occurredAt")),
			field("note", jsonPath(column(event, "properties"), "note")),
		],
	}),
});

export const resultsSettings = {
	pageSize: 10,
	sourceName: "readingLog",
	rowKeyFields: ["entityId", "occurredAt"],
	entityLink: { entityIdField: "entityId" },
	columns: [
		{ label: "Note", field: "note", displayKind: "text" },
		{ label: "Occurred", field: "occurredAt", displayKind: "date" },
	],
};
