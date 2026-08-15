import { column, eq, literal, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import {
	buildSavedViewDataSources,
	createAuthenticatedClient,
	createSavedView,
	entityBrowserSettings,
	findBuiltinPluginBySlug,
	getSavedView,
	listSavedViews,
	rowsDataSources,
	updateSavedView,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const entity = table("entity", "entity");
const savedViewQuery = requirePresent(
	rowsDataSources.queries.savedView,
	"Saved-view fixture query is missing",
);
const alternateDataSources = {
	...rowsDataSources,
	queries: {
		...rowsDataSources.queries,
		savedView: { ...savedViewQuery, where: eq(column(entity, "name"), literal("A Book")) },
	},
};

describe("saved view definitions", () => {
	it.live("stores shipped media views with a canonical renderer, settings, and data source", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const mediaPlugin = yield* findBuiltinPluginBySlug(client, "media");
			const allBooks = requirePresent(
				(yield* listSavedViews(client, { pluginSlug: mediaPlugin.slug })).find(
					(view) => view.name === "All Books",
				),
				"All Books saved view not found",
			);

			expect(allBooks.renderer).toEqual({ kind: "kernel", name: "entity-browser" });
			expect(allBooks.settings).toMatchObject({
				pageSize: 20,
				defaultLayout: "grid",
				sourceName: "savedView",
				entityIdField: "entityId",
				layouts: ["grid", "list", "table"],
				ownerPluginIdField: "ownerPluginId",
				entitySchemaSlugField: "entitySchemaSlug",
			});
			expect(allBooks.dataSources?.queries.savedView).toMatchObject({
				from: { alias: "entity", table: "entity" },
				output: { type: "rows", pagination: { limit: 20 } },
			});
		}),
	);

	it.live("creates and retrieves the complete canonical definition", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createSavedView(client, {
				name: `Canonical View ${crypto.randomUUID()}`,
			});
			const fetched = yield* getSavedView(client, created.slug);

			expect(created.renderer).toEqual({ kind: "kernel", name: "entity-browser" });
			expect(created.settings).toEqual(entityBrowserSettings);
			expect(created.dataSources).toEqual(rowsDataSources);
			expect(fetched).toMatchObject({
				id: created.id,
				renderer: created.renderer,
				settings: created.settings,
				dataSources: created.dataSources,
			});
		}),
	);

	it.live("updates settings and data sources together", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createSavedView(client);
			const settings = { ...entityBrowserSettings, pageSize: 7 };
			const updated = yield* updateSavedView(client, created.slug, {
				settings,
				dataSources: alternateDataSources,
			});
			const fetched = yield* getSavedView(client, created.slug);

			expect(updated.settings).toEqual(settings);
			expect(updated.dataSources).toEqual(alternateDataSources);
			expect(fetched.settings).toEqual(settings);
			expect(fetched.dataSources).toEqual(alternateDataSources);
		}),
	);

	it.live("accepts an unknown schema filter as an empty entity browser", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const dataSources = buildSavedViewDataSources(["does-not-exist"]);
			const created = yield* createSavedView(client, {
				dataSources,
				name: `Unknown Schema View ${crypto.randomUUID()}`,
			});

			expect(created.dataSources).toEqual(dataSources);
			expect(created.renderer).toEqual({ kind: "kernel", name: "entity-browser" });
		}),
	);
});
