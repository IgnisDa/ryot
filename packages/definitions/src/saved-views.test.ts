import { expect, it } from "bun:test";

import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import type {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
	SavedViewRenderer,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug, PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import {
	and,
	column,
	document,
	eq,
	field,
	jsonElementsJoin,
	jsonPath,
	literal,
	pluginId,
	rows,
	table,
} from "@ryot-app/ryotql";
import { executableFixture } from "@ryot-app/ryotql/fixture.test-support";
import { Result, Schema } from "effect";

import {
	type SavedViewIssue,
	savedViewSourceIssue,
	validateSavedViewDefinition,
} from "./saved-views";

const validate = (
	renderer: SavedViewRenderer,
	settings: Readonly<Record<string, unknown>>,
	dataSources: Parameters<typeof validateSavedViewDefinition>[0]["dataSources"],
	pluginPage: Parameters<typeof validateSavedViewDefinition>[0]["pluginPage"],
) =>
	validateSavedViewDefinition({
		renderer,
		settings,
		pluginPage,
		dataSources,
		schemas: [],
		options: { kernelBuiltin: false },
	});

const failure = (result: ReturnType<typeof validate>): undefined | SavedViewIssue =>
	Result.isFailure(result) ? result.failure : undefined;

const incompatible = (message: string): SavedViewIssue => ({
	message,
	code: "settings-incompatible",
});

const entity = table("entity", "entity");
const dataSources = document({
	entities: rows(entity, {
		where: and(
			eq(
				column(entity, "entitySchemaPluginId"),
				pluginId({ kind: "local", pluginId: PluginId.make("plugin-a-id") }),
			),
			eq(column(entity, "entitySchemaSlug"), literal("unit")),
		),
		fields: [
			field("entityId", column(entity, "id")),
			field("name", column(entity, "name")),
			field("ownerPluginId", column(entity, "entitySchemaPluginId")),
			field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
		],
	}),
});
const browserSettings = {
	pageSize: 20,
	tableColumns: null,
	defaultLayout: "grid",
	sourceName: "entities",
	layouts: ["grid", "list"],
	summary: { image: null, subtitle: null },
	subject: {
		entityAlias: "entity",
		schemas: [
			{
				slug: EntitySchemaSlug.make("unit"),
				owner: { kind: "plugin", pluginId: PluginId.make("plugin-a-id") },
			},
		],
	},
	addAction: {
		type: "provider-search",
		library: {
			entryEvent: null,
			librarySchemaSlug: "fixture-library",
			relationshipSlug: "in-fixture-library",
		},
		schema: {
			slug: EntitySchemaSlug.make("unit"),
			owner: { kind: "plugin", pluginId: PluginId.make("plugin-a-id") },
		},
	},
} satisfies EntityBrowserSavedViewSettings;

const entityBrowser = { kind: "kernel", name: "entity-browser" } as const;
const options = { kernelBuiltin: false };

it("accepts a canonical entity-browser definition in both kernel browser renderers", () => {
	expect(
		savedViewSourceIssue(entityBrowser, browserSettings, executableFixture(dataSources), options),
	).toBeUndefined();
	for (const name of ["entity-browser", "collection-browser"] as const) {
		expect(
			Result.isSuccess(validate({ name, kind: "kernel" }, browserSettings, dataSources, null)),
		).toBe(true);
	}
});

const browserIssue = (
	settings: EntityBrowserSavedViewSettings,
	source: typeof dataSources = dataSources,
) => savedViewSourceIssue(entityBrowser, settings, executableFixture(source), options);

it("rejects summary fields that the source does not project", () => {
	expect(browserIssue({ ...browserSettings, summary: { image: "image", subtitle: null } })).toEqual(
		incompatible("Entity-browser configured field 'image' must be a projected scalar field"),
	);
	expect(
		browserIssue({
			...browserSettings,
			summary: { image: null, subtitle: { field: "year", displayKind: "year" } },
		}),
	).toEqual(
		incompatible("Entity-browser configured field 'year' must be a projected scalar field"),
	);
});

it("rejects a provider add action schema outside the subject", () => {
	expect(
		browserIssue({
			...browserSettings,
			addAction: {
				...browserSettings.addAction,
				schema: {
					...browserSettings.addAction.schema,
					owner: { kind: "plugin", pluginId: PluginId.make("other-plugin-id") },
				},
			},
		}),
	).toEqual(incompatible("Entity-browser addAction schema must be one of the subject schemas"));
});

it("rejects a subject alias that is not an entity table in the source", () => {
	const issue = incompatible(
		"Entity-browser subject alias 'missing' must be an entity table in the source query",
	);
	const subject = { ...browserSettings.subject, entityAlias: "missing" };
	expect(browserIssue({ ...browserSettings, subject })).toEqual(issue);
	const eventSource = document({
		entities: rows(table("event", "missing"), {
			fields: [field("name", column(table("event", "missing"), "id"))],
		}),
	});
	expect(browserIssue({ ...browserSettings, subject }, eventSource)).toEqual(issue);
	const elementSource = document({
		entities: rows(entity, {
			fields: dataSources.queries.entities.output.fields,
			joins: [
				jsonElementsJoin("inner", "missing", jsonPath(column(entity, "properties"), "items")),
			],
		}),
	});
	expect(browserIssue({ ...browserSettings, subject }, elementSource)).toEqual(issue);
});

it("rejects duplicate subject schemas", () => {
	expect(
		browserIssue({
			...browserSettings,
			subject: {
				...browserSettings.subject,
				schemas: [browserSettings.subject.schemas[0], browserSettings.subject.schemas[0]],
			},
		}),
	).toEqual(incompatible("Entity-browser subject schemas must not contain duplicates"));
});

it("does not apply entity provenance validation to plugin-route add actions", () => {
	expect(
		browserIssue({
			...browserSettings,
			addAction: {
				type: "plugin-route",
				path: "/items/item-1",
				search: { tab: "history" },
				packageId: PluginPackageId.make("test/target"),
			},
		}),
	).toBeUndefined();
});

const resultsTable = { kind: "kernel", name: "results-table" } as const;

const tableSettings = () => ({
	pageSize: 20,
	entityLink: null,
	sourceName: "entities",
	controls: { filter: true },
	rowKeyFields: ["entityId"] as const,
	columns: [{ label: "Name", field: "name", displayKind: "text" }] as const,
});

it("accepts valid results-table filter fields and rejects invalid ones", () => {
	const nameField = {
		key: "name",
		type: "text",
		label: "Name",
		kind: "value",
		field: "name",
	} as const;
	expect(
		Result.isSuccess(
			validate(
				resultsTable,
				tableSettings(),
				{ ...dataSources, controls: { filter: { kind: "outputs", fields: [nameField] } } },
				null,
			),
		),
	).toBe(true);
	for (const [filterFields, message] of [
		[[nameField, nameField], "Control filter keys must be unique"],
		[
			[{ ...nameField, field: "missing" }],
			"Filter field 'name' references missing output field 'missing'",
		],
	] as const) {
		expect(
			failure(
				validate(
					resultsTable,
					tableSettings(),
					{ ...dataSources, controls: { filter: { kind: "outputs", fields: filterFields } } },
					null,
				),
			),
		).toEqual(incompatible(message));
	}
});

it("rejects relationship filter fields on results tables", () => {
	const decoded = Schema.decodeUnknownResult(RyotQLDocument)({
		...dataSources,
		controls: {
			filter: {
				kind: "outputs",
				fields: [
					{
						key: "tags",
						label: "Tags",
						kind: "relationship",
						direction: "outgoing",
						relationship: { slug: "tagged", owner: { kind: "kernel" } },
					},
				],
			},
		},
	});
	expect(Result.isFailure(decoded)).toBe(true);
});

it("accepts a canonical results-table definition", () => {
	const settings = {
		pageSize: 20,
		sourceName: "entities",
		rowKeyFields: ["entityId"],
		entityLink: { entityIdField: "entityId" },
		columns: [{ label: "Name", field: "name", displayKind: "text" }],
	} satisfies ResultsTableSavedViewSettings;
	expect(
		savedViewSourceIssue(resultsTable, settings, executableFixture(dataSources), options),
	).toBeUndefined();
	expect(Result.isSuccess(validate(resultsTable, settings, dataSources, null))).toBe(true);
});

const pluginRenderer = { pluginId: "plugin-id", exportName: "summary", kind: "plugin" as const };
const pluginPage = {
	settingsSchema: {
		unknownKeys: "strict" as const,
		fields: {
			title: {
				label: "Title",
				type: "string" as const,
				description: "Summary title",
				validation: { required: true as const },
			},
		},
	},
};

it("authorizes plugin page renderers and validates their settings", () => {
	for (const source of [null, dataSources]) {
		expect(Result.isSuccess(validate(pluginRenderer, { title: "Home" }, source, pluginPage))).toBe(
			true,
		);
	}
	expect(failure(validate(pluginRenderer, {}, null, pluginPage))).toEqual(
		incompatible("title: is missing"),
	);
});

it("rejects plugin renderers without an available page export", () => {
	expect(failure(validate(pluginRenderer, { title: "Home" }, null, null))).toEqual({
		code: "renderer-not-found",
	});
});

const withCursor = () => {
	const source = dataSources.queries.entities;
	return {
		queries: {
			entities: {
				...source,
				output: {
					...source.output,
					pagination: Object.assign({ ...source.output.pagination }, { after: "next" }),
				},
			},
		},
	};
};

it("validates plugin data sources and rejects stored cursors", () => {
	const missing = table("missing-table", "missing");
	expect(
		failure(
			validate(
				pluginRenderer,
				{ title: "Home" },
				document({ invalid: rows(missing, { fields: [] }) }),
				pluginPage,
			),
		)?.code,
	).toBe("settings-incompatible");
	expect(failure(validate(pluginRenderer, { title: "Home" }, withCursor(), pluginPage))).toEqual(
		incompatible("Invalid authored document shape"),
	);
});

it("rejects stored cursors", () => {
	expect(failure(validate(entityBrowser, browserSettings, withCursor(), null))).toEqual(
		incompatible("Invalid authored document shape"),
	);
});

it("rejects the kernel calendar renderer outside kernel built-ins", () => {
	const renderer = { kind: "kernel" as const, name: "calendar" as const };
	const issue = incompatible("Calendar views are kernel built-ins only");
	expect(failure(validate(renderer, {}, null, null))).toEqual(issue);
	expect(failure(validate(renderer, {}, dataSources, null))).toEqual(issue);
	expect(savedViewSourceIssue(renderer, {}, null, { kernelBuiltin: true })).toBeUndefined();
});
