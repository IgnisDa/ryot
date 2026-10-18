import { ascending, column, document, field, jsonPath, rows, table } from "@ryot-app/ryotql";

const entity = table("entity", "entity");

export const browserDataSources = document({
	savedView: rows(entity, {
		limit: 2,
		orderBy: [ascending(column(entity, "name"))],
		fields: [
			field("name", column(entity, "name")),
			field("year", jsonPath(column(entity, "properties"), "publishYear")),
			field("status", jsonPath(column(entity, "properties"), "status")),
			field("image", jsonPath(column(entity, "properties"), "images", 0)),
		],
	}),
});

export const browserSettings = {
	pageSize: 2,
	sortChoices: [],
	defaultLayout: "grid",
	searchFields: ["name"],
	sourceName: "savedView",
	layouts: ["grid", "list", "table"],
	summary: { image: null, subtitle: null },
	subject: {
		entityAlias: "entity",
		schemas: [{ slug: "item", owner: { kind: "plugin", pluginId: "fixture" } }],
	},
	tableColumns: [
		{ label: "Image", field: "image", displayKind: "managed-asset" },
		{ label: "Name", field: "name", displayKind: "text" },
		{ label: "Year", field: "year", displayKind: "year" },
	],
	addAction: {
		type: "provider-search",
		schema: { slug: "item", owner: { kind: "plugin", pluginId: "fixture" } },
		library: { librarySchemaSlug: "fixture-library", relationshipSlug: "in-fixture-library" },
	},
	filterFields: [
		{
			type: "enum",
			key: "status",
			kind: "value",
			label: "Status",
			field: "status",
			choices: [
				{ value: "read", label: "Read" },
				{ value: "unread", label: "Unread" },
			],
		},
		{ key: "year", kind: "value", label: "Year", field: "year", type: "number" },
		{
			key: "authors",
			label: "Authors",
			kind: "relationship",
			direction: "outgoing",
			relationship: { slug: "item-to-person", owner: { kind: "plugin", pluginId: "fixture" } },
		},
	],
};

export const browserRow = (entityId: string, name: string) => ({
	name,
	year: 2026,
	image: null,
	__entityBrowserName: name,
	__entityBrowserId: entityId,
	__entityBrowserSchemaSlug: "item",
	__entityBrowserOwnerPluginId: "fixture",
	__entityBrowserPopulationStatus: { state: "succeeded", availability: "complete" },
	__entityBrowserTranslationStatus: { state: "succeeded", availability: "complete" },
});

export const browserPage = (
	items: readonly Record<string, unknown>[],
	hasMore = false,
	nextCursor: string | null = null,
) => ({
	data: {
		entityBrowser: { items, type: "rows" as const, pageInfo: { hasMore, limit: 2, nextCursor } },
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
