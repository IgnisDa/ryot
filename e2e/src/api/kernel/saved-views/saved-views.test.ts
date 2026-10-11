import { column, eq, literal, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import {
	buildSavedViewDataSources,
	createAuthenticatedClient,
	createSavedView,
	entityBrowserSettings,
	findSavedViewById,
	getSavedView,
	listSavedViews,
	rowsDataSources,
	updateSavedView,
} from "~/fixtures/kernel";
import { findMediaEntitySchema } from "~/fixtures/plugins/media";
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
			const { schema } = yield* findMediaEntitySchema(client, "book");
			const pluginId = requirePresent(
				schema.reference.owner.kind === "plugin" ? schema.reference.owner.pluginId : undefined,
				"Media book schema must have a plugin owner",
			);
			const allBooks = requirePresent(
				(yield* listSavedViews(client, { pluginId })).find((view) => view.name === "All Books"),
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
			const stored = yield* findSavedViewById(client, created.id);
			const fetched = yield* getSavedView(client, stored.reference);

			expect(stored.renderer).toEqual({ kind: "kernel", name: "entity-browser" });
			expect(stored.settings).toEqual(entityBrowserSettings);
			expect(stored.dataSources).toEqual(rowsDataSources);
			expect(fetched).toMatchObject({
				id: created.id,
				renderer: stored.renderer,
				settings: stored.settings,
				dataSources: stored.dataSources,
			});
		}),
	);

	it.live("updates settings and data sources together", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createSavedView(client);
			const stored = yield* findSavedViewById(client, created.id);
			const settings = { ...entityBrowserSettings, pageSize: 7 };
			const updated = yield* updateSavedView(client, stored.reference, {
				settings,
				dataSources: alternateDataSources,
			});
			const fetched = yield* getSavedView(client, stored.reference);

			expect(updated.id).toBe(created.id);
			expect(fetched.settings).toEqual(settings);
			expect(fetched.dataSources).toEqual(alternateDataSources);
		}),
	);

	it.live("accepts an unknown schema filter as an empty entity browser", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findMediaEntitySchema(client, "book");
			const pluginId = requirePresent(
				schema.reference.owner.kind === "plugin" ? schema.reference.owner.pluginId : undefined,
				"Media book schema must have a plugin owner",
			);
			const dataSources = buildSavedViewDataSources(["does-not-exist"], {
				pluginId,
				kind: "local",
			});
			const created = yield* createSavedView(client, {
				dataSources,
				name: `Unknown Schema View ${crypto.randomUUID()}`,
			});

			const stored = yield* findSavedViewById(client, created.id);
			expect(stored.dataSources).toEqual(dataSources);
			expect(stored.renderer).toEqual({ kind: "kernel", name: "entity-browser" });
		}),
	);
});
