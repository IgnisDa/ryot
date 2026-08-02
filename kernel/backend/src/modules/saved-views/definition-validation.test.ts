import { expect, it } from "@effect/vitest";
import type {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { SavedViewBadRequest } from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { and, column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";

import {
	validateEntityBrowserSavedViewDefinition,
	validateResultsTableSavedViewDefinition,
	validateSavedViewDefinition,
} from "./definition-validation";

const entity = table("entity", "entity");
const dataSources = document({
	entities: rows(entity, {
		where: and(
			eq(column(entity, "entitySchemaPluginId"), literal("media-plugin-id")),
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
	entityIdField: "entityId",
	ownerPluginIdField: "ownerPluginId",
	entitySchemaSlugField: "entitySchemaSlug",
	addAction: {
		type: "provider-search",
		ownerPluginId: "media-plugin-id",
		entitySchemaSlug: EntitySchemaSlug.make("book"),
	},
} satisfies EntityBrowserSavedViewSettings;

it.effect("accepts a canonical entity-browser definition", () =>
	validateEntityBrowserSavedViewDefinition({ dataSources, settings: browserSettings }),
);

it.effect("rejects provider add provenance that does not match the source", () =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(
			validateEntityBrowserSavedViewDefinition({
				dataSources,
				settings: {
					...browserSettings,
					addAction: { ...browserSettings.addAction, ownerPluginId: "other-plugin-id" },
				},
			}),
		);
		assertExitFails(
			exit,
			new SavedViewBadRequest({
				reason: {
					code: "settings-incompatible",
					message: "Entity-browser addAction must match the fixed source entity owner and schema",
				},
			}),
		);
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
