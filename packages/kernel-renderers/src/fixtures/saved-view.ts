import { EntitySchemaBrowse } from "@ryot-app/contract/modules/filters/browse";
import { FilterField } from "@ryot-app/contract/modules/filters/schemas";
import { controlTargets } from "@ryot-app/contract/modules/ryotql/authored";
import type { DescribeResponse } from "@ryot-app/contract/modules/ryotql/request";
import { mountPluginPage } from "@ryot-app/plugin-client-sdk/testing";
import { ascending, column, document, field, jsonPath, rows, table } from "@ryot-app/ryotql";
import { collectionsFilterField } from "@ryot-app/ryotql-recipes/filters";
import { requireInlineDocument } from "@ryot-app/ryotql-recipes/test-utils";
import { Result, Schema } from "effect";

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
	defaultLayout: "grid",
	sourceName: "savedView",
	layouts: ["grid", "list", "table"],
	summary: { image: null, subtitle: null },
	controls: { sort: true, filter: true, search: "search" },
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
		library: {
			entryEvent: null,
			librarySchemaSlug: "fixture-library",
			relationshipSlug: "in-fixture-library",
		},
	},
};

const subject = table("entity", "subject");

export const browserBrowse = {
	slug: "item",
	pluginId: "fixture",
	browse: {
		fields: [
			{
				type: "enum",
				key: "status",
				kind: "value",
				label: "Status",
				expression: jsonPath(column(subject, "properties"), "status"),
				choices: [
					{ value: "read", label: "Read" },
					{ value: "unread", label: "Unread" },
				],
			},
			{
				key: "year",
				kind: "value",
				label: "Year",
				type: "number",
				expression: jsonPath(column(subject, "properties"), "publishYear"),
				sort: {
					label: "Release year",
					defaultDirection: "desc",
					ascending: "Oldest first",
					descending: "Newest first",
				},
			},
			{
				key: "authors",
				label: "Authors",
				kind: "relationship",
				direction: "outgoing",
				relationship: { slug: "item-to-person", owner: { kind: "plugin", pluginId: "fixture" } },
			},
		],
	},
};

export const browsePage = (items: readonly Record<string, unknown>[]) => ({
	data: {
		schemas: {
			items,
			type: "rows" as const,
			pageInfo: { hasMore: false, nextCursor: null, limit: items.length },
		},
	},
});

export const mountBrowsingPage = (
	component: Parameters<typeof mountPluginPage>[0],
	options: Parameters<typeof mountPluginPage>[1] & {
		readonly description?: typeof DescribeResponse.Type;
	},
	browse: readonly Record<string, unknown>[] = [browserBrowse],
) => {
	const page: ReturnType<typeof mountPluginPage> = mountPluginPage(component, {
		...options,
		onClientMessage: (message) => {
			if (message.type === "ryotql-request" && message.action === "describe") {
				const fields = browse.flatMap(
					(entry) =>
						Result.getOrThrow(Schema.decodeUnknownResult(EntitySchemaBrowse)(entry["browse"]))
							.fields,
				);
				const source = message.request.source;
				const authoredDocument = source.kind === "inline" ? source.document : undefined;
				const outputFields = (
					authoredDocument?.controls?.filter === undefined
						? []
						: controlTargets(authoredDocument.controls.filter)
				).flatMap((target) => (target.kind === "outputs" ? target.fields : []));
				const outputSorts = (
					authoredDocument?.controls?.sort === undefined
						? []
						: controlTargets(authoredDocument.controls.sort)
				).flatMap((target) =>
					target.kind === "outputs"
						? target.fields.map((entry) => ({
								key: entry.key,
								...(entry.sort ?? {
									label: entry.label,
									ascending: "Ascending",
									descending: "Descending",
									defaultDirection: "asc" as const,
								}),
							}))
						: [],
				);
				page.replyQuery(message.requestId, {
					outcome: "success",
					response: options.description ?? {
						parameters: { fields: {} },
						sort: [
							{
								key: "name",
								label: "Name",
								ascending: "A–Z",
								descending: "Z–A",
								defaultDirection: "asc",
							},
							...fields.flatMap((browseField) =>
								(browseField.kind === "value" || browseField.kind === "sort") && browseField.sort
									? [{ ...browseField.sort, key: browseField.key }]
									: [],
							),
							...outputSorts,
						],
						filter: [
							...fields.flatMap((browseField): readonly FilterField[] => {
								if (browseField.kind === "sort") {
									return [];
								}
								if (browseField.kind === "relationship" || browseField.kind === "session-event") {
									return [browseField];
								}
								const { sort: _sort, expression: _expression, ...spec } = browseField;
								return [
									Result.getOrThrow(
										Schema.decodeResult(FilterField)({ ...spec, field: browseField.key }),
									),
								];
							}),
							...outputFields.map(({ sort: _sort, ...entry }) => entry),

							collectionsFilterField,
						],
					},
				});
			}
			if (
				message.type === "ryotql-request" &&
				message.action === "execute" &&
				message.request.source.kind === "inline" &&
				"schemas" in requireInlineDocument(message.request).queries
			) {
				page.replyQuery(message.requestId, { outcome: "success", response: browsePage(browse) });
			}
		},
	});
	return page;
};

export const browserRow = (entityId: string, name: string) => ({
	name,
	year: 2026,
	image: null,
	memberCount: 0,
	__entityBrowserName: name,
	__entityBrowserId: entityId,
	__entityBrowserSchemaSlug: "item",
	__entityBrowserOwnerPluginId: "fixture",
	__entityBrowserPopulationStatus: { state: "succeeded", availability: "complete" },
	__entityBrowserTranslationStatus: { state: "succeeded", availability: "complete" },
	__entityPresentation: {
		data: { name },
		scope: "owner",
		schemaSlug: "item",
		pluginId: "fixture",
		context: { now: 0, settings: null, timeZone: "UTC" },
	},
});

export const browserPage = (
	items: readonly Record<string, unknown>[],
	hasMore = false,
	nextCursor: null | string = null,
) => ({
	data: {
		savedView: { items, type: "rows" as const, pageInfo: { hasMore, limit: 2, nextCursor } },
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
