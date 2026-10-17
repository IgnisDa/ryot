import { expect, it } from "@effect/vitest";
import type {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { SavedViewBadRequest } from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug, PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { and, column, document, eq, field, literal, pluginId, rows, table } from "@ryot-app/ryotql";
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
				pluginId({ kind: "local", pluginId: PluginId.make("media-plugin-id") }),
			),
			eq(column(entity, "entitySchemaSlug"), literal("book")),
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
				slug: EntitySchemaSlug.make("book"),
				owner: { kind: "plugin", pluginId: PluginId.make("media-plugin-id") },
			},
		],
	},
	addAction: {
		type: "provider-search",
		library: { librarySchemaSlug: "media-library", relationshipSlug: "in-media-library" },
		schema: {
			slug: EntitySchemaSlug.make("book"),
			owner: { kind: "plugin", pluginId: PluginId.make("media-plugin-id") },
		},
	},
} satisfies EntityBrowserSavedViewSettings;

it.effect("accepts a canonical entity-browser definition", () =>
	validateEntityBrowserSavedViewDefinition({ dataSources, settings: browserSettings }),
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

it.effect("accepts a canonical results-table definition", () => {
	const settings = {
		pageSize: 20,
		sourceName: "entities",
		rowKeyFields: ["entityId"],
		entityLink: { entityIdField: "entityId" },
		columns: [{ label: "Name", field: "name", displayKind: "text" }],
	} satisfies ResultsTableSavedViewSettings;
	return validateResultsTableSavedViewDefinition({ settings, dataSources });
});

it.effect("authorizes plugin page renderers and validates their settings", () =>
	Effect.gen(function* () {
		const renderer = { pluginId: "plugin-id", exportName: "summary", kind: "plugin" as const };
		const page = {
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
		expect(yield* validateSavedViewDefinition(renderer, { title: "Home" }, null, null, page)).toBe(
			null,
		);
		const exit = yield* Effect.exit(validateSavedViewDefinition(renderer, {}, null, null, page));
		assertExitFails(
			exit,
			new SavedViewBadRequest({
				reason: { message: "title: is missing", code: "settings-incompatible" },
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
