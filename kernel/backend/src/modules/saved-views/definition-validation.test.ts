import { expect, it } from "@effect/vitest";
import type {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { SavedViewBadRequest } from "@ryot-app/contract/modules/saved-views/schemas";
import {
	EntitySchemaSlug,
	PluginId,
	PluginPackageId,
	RelationshipSchemaSlug,
} from "@ryot-app/contract/schema/brands";
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
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Effect } from "effect";

import {
	validateEntityBrowserSavedViewDefinition,
	validateResultsTableSavedViewDefinition,
	validateSavedViewDefinition,
} from "./definition-validation";

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
	sortChoices: [],
	tableColumns: null,
	defaultLayout: "grid",
	sourceName: "entities",
	searchFields: ["name"],
	layouts: ["grid", "list"],
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
		library: { librarySchemaSlug: "fixture-library", relationshipSlug: "in-fixture-library" },
		schema: {
			slug: EntitySchemaSlug.make("unit"),
			owner: { kind: "plugin", pluginId: PluginId.make("plugin-a-id") },
		},
	},
} satisfies EntityBrowserSavedViewSettings;

it.effect("accepts a canonical entity-browser definition", () =>
	validateEntityBrowserSavedViewDefinition({ dataSources, settings: browserSettings }),
);

it.effect("validates both kernel browser renderers without returning a renderer ID", () =>
	Effect.gen(function* () {
		for (const name of ["entity-browser", "collection-browser"] as const) {
			expect(
				yield* validateSavedViewDefinition(
					{ name, kind: "kernel" },
					browserSettings,
					dataSources,
					null,
				),
			).toBeUndefined();
		}
	}),
);

const rejectsBrowserSettings = (
	settings: EntityBrowserSavedViewSettings,
	message: string,
	source: typeof dataSources = dataSources,
) =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(
			validateEntityBrowserSavedViewDefinition({ settings, dataSources: source }),
		);
		assertExitFails(
			exit,
			new SavedViewBadRequest({ reason: { message, code: "settings-incompatible" } }),
		);
	});

it.effect("rejects a provider add action schema outside the subject", () =>
	rejectsBrowserSettings(
		{
			...browserSettings,
			addAction: {
				...browserSettings.addAction,
				schema: {
					...browserSettings.addAction.schema,
					owner: { kind: "plugin", pluginId: PluginId.make("other-plugin-id") },
				},
			},
		},
		"Entity-browser addAction schema must be one of the subject schemas",
	),
);

it.effect("rejects a subject alias that is not an entity table in the source", () =>
	Effect.gen(function* () {
		const message =
			"Entity-browser subject alias 'missing' must be an entity table in the source query";
		const subject = { ...browserSettings.subject, entityAlias: "missing" };
		yield* rejectsBrowserSettings({ ...browserSettings, subject }, message);
		const eventSource = document({
			entities: rows(table("event", "missing"), {
				fields: [field("name", column(table("event", "missing"), "id"))],
			}),
		});
		yield* rejectsBrowserSettings({ ...browserSettings, subject }, message, eventSource);
		const elementSource = document({
			entities: rows(entity, {
				fields: dataSources.queries.entities.output.fields,
				joins: [
					jsonElementsJoin("inner", "missing", jsonPath(column(entity, "properties"), "items")),
				],
			}),
		});
		yield* rejectsBrowserSettings({ ...browserSettings, subject }, message, elementSource);
	}),
);

it.effect("rejects duplicate subject schemas", () =>
	rejectsBrowserSettings(
		{
			...browserSettings,
			subject: {
				...browserSettings.subject,
				schemas: [browserSettings.subject.schemas[0], browserSettings.subject.schemas[0]],
			},
		},
		"Entity-browser subject schemas must not contain duplicates",
	),
);

it.effect("does not apply entity provenance validation to plugin-route add actions", () =>
	validateEntityBrowserSavedViewDefinition({
		dataSources,
		settings: {
			...browserSettings,
			addAction: {
				type: "plugin-route",
				path: "/items/item-1",
				search: { tab: "history" },
				packageId: PluginPackageId.make("test/target"),
			},
		},
	}),
);

it.effect("accepts valid filter fields and rejects invalid ones as bad requests", () =>
	Effect.gen(function* () {
		const nameField = {
			key: "name",
			type: "text",
			label: "Name",
			kind: "value",
			field: "name",
		} as const;
		yield* validateEntityBrowserSavedViewDefinition({
			dataSources,
			settings: { ...browserSettings, filterFields: [nameField] },
		});
		yield* rejectsBrowserSettings(
			{ ...browserSettings, filterFields: [nameField, nameField] },
			"Filter field key 'name' must be unique",
		);
		yield* rejectsBrowserSettings(
			{ ...browserSettings, filterFields: [{ ...nameField, field: "missing" }] },
			"Filter field 'name' must reference a projected scalar field",
		);
	}),
);

it.effect("rejects relationship filter fields on results tables", () =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(
			validateResultsTableSavedViewDefinition({
				dataSources,
				settings: {
					pageSize: 20,
					entityLink: null,
					sourceName: "entities",
					rowKeyFields: ["entityId"],
					columns: [{ label: "Name", field: "name", displayKind: "text" }],
					filterFields: [
						{
							key: "tags",
							label: "Tags",
							kind: "relationship",
							direction: "outgoing",
							relationship: {
								owner: { kind: "kernel" },
								slug: RelationshipSchemaSlug.make("tagged"),
							},
						},
					],
				},
			}),
		);
		assertExitFails(
			exit,
			new SavedViewBadRequest({
				reason: {
					code: "settings-incompatible",
					message: "Filter field 'tags' cannot be a relationship on a results table",
				},
			}),
		);
	}),
);

it.effect("accepts a canonical results-table definition", () =>
	Effect.gen(function* () {
		const settings = {
			pageSize: 20,
			sourceName: "entities",
			rowKeyFields: ["entityId"],
			entityLink: { entityIdField: "entityId" },
			columns: [{ label: "Name", field: "name", displayKind: "text" }],
		} satisfies ResultsTableSavedViewSettings;
		yield* validateResultsTableSavedViewDefinition({ settings, dataSources });
		expect(
			yield* validateSavedViewDefinition(
				{ kind: "kernel", name: "results-table" },
				settings,
				dataSources,
				null,
			),
		).toBeUndefined();
	}),
);

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

it.effect("authorizes plugin page renderers and validates their settings", () =>
	Effect.gen(function* () {
		for (const source of [null, dataSources]) {
			expect(
				yield* validateSavedViewDefinition(pluginRenderer, { title: "Home" }, source, pluginPage),
			).toBeUndefined();
		}
		const exit = yield* Effect.exit(
			validateSavedViewDefinition(pluginRenderer, {}, null, pluginPage),
		);
		assertExitFails(
			exit,
			new SavedViewBadRequest({
				reason: { message: "title: is missing", code: "settings-incompatible" },
			}),
		);
	}),
);

it.effect("rejects plugin renderers without an available page export", () =>
	Effect.gen(function* () {
		assertExitFails(
			yield* Effect.exit(
				validateSavedViewDefinition(pluginRenderer, { title: "Home" }, null, null),
			),
			new SavedViewBadRequest({ reason: { code: "renderer-not-found" } }),
		);
	}),
);

it.effect("validates plugin data sources and rejects stored cursors", () =>
	Effect.gen(function* () {
		const missing = table("missing-table", "missing");
		const invalid = yield* validateSavedViewDefinition(
			pluginRenderer,
			{ title: "Home" },
			document({ invalid: rows(missing, { fields: [] }) }),
			pluginPage,
		).pipe(Effect.flip);
		expect(invalid.reason.code).toBe("settings-incompatible");
		const source = dataSources.queries.entities;
		assertExitFails(
			yield* Effect.exit(
				validateSavedViewDefinition(
					pluginRenderer,
					{ title: "Home" },
					{
						queries: {
							entities: {
								...source,
								output: {
									...source.output,
									pagination: { ...source.output.pagination, after: "next" },
								},
							},
						},
					},
					pluginPage,
				),
			),
			new SavedViewBadRequest({
				reason: {
					code: "settings-incompatible",
					message: "Stored data source 'entities' must not contain a cursor",
				},
			}),
		);
	}),
);

it.effect("rejects stored cursors", () =>
	Effect.gen(function* () {
		const source = dataSources.queries["entities"];
		const exit = yield* Effect.exit(
			validateEntityBrowserSavedViewDefinition({
				settings: browserSettings,
				dataSources: {
					queries: {
						entities: {
							...source,
							output: {
								...source.output,
								pagination: { ...source.output.pagination, after: "next" },
							},
						},
					},
				},
			}),
		);
		assertExitFails(
			exit,
			new SavedViewBadRequest({
				reason: {
					code: "settings-incompatible",
					message: "Stored data source 'entities' must not contain a cursor",
				},
			}),
		);
	}),
);

it.effect("rejects the kernel calendar renderer for user-owned views", () =>
	Effect.gen(function* () {
		const renderer = { kind: "kernel" as const, name: "calendar" as const };
		const failure = new SavedViewBadRequest({
			reason: {
				code: "settings-incompatible",
				message: "Calendar views are kernel built-ins only",
			},
		});
		assertExitFails(
			yield* Effect.exit(validateSavedViewDefinition(renderer, {}, null, null)),
			failure,
		);
		assertExitFails(
			yield* Effect.exit(validateSavedViewDefinition(renderer, {}, dataSources, null)),
			failure,
		);
	}),
);
