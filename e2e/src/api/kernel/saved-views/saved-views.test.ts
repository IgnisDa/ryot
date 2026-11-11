import { column, eq, literal, table } from "@ryot-app/ryotql";
import { arrayContaining } from "@ryot-app/testing/matchers";
import { randomUuid } from "@ryot-app/testing/random";
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
import { assertCondition, requirePresent } from "~/support/assertions";
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
				layouts: ["grid", "list", "table"],
				subject: {
					entityAlias: "entity",
					schemas: [{ slug: "book", owner: { pluginId, kind: "plugin" } }],
				},
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
				name: `Canonical View ${yield* randomUuid}`,
			});
			const stored = yield* findSavedViewById(client, created.id);
			const fetched = yield* getSavedView(client, stored.reference);
			const { pluginId } = yield* findMediaEntitySchema(client, "book");

			expect(stored.renderer).toEqual({ kind: "kernel", name: "entity-browser" });
			expect(stored.settings).toEqual(entityBrowserSettings(pluginId));
			const authored = rowsDataSources;
			const source = requirePresent(authored.queries.savedView, "Authored source missing");
			assertCondition(source.output.type === "rows", "Expected authored rows");
			expect(stored.dataSources).toMatchObject({
				controls: authored.controls,
				parameters: authored.parameters,
			});
			expect(stored.dataSources?.queries.savedView).toMatchObject({
				from: source.from,
				where: { type: "and", predicates: arrayContaining([source.where]) },
				output: { ...source.output, fields: arrayContaining(source.output.fields) },
			});
			expect(stored.dataSources?.queries.count?.output.type).toBe("aggregate");
			expect(stored.dataSources?.queries.ids?.output.type).toBe("rows");
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
			const { pluginId } = yield* findMediaEntitySchema(client, "book");
			const created = yield* createSavedView(client, {});
			const stored = yield* findSavedViewById(client, created.id);
			const settings = { ...entityBrowserSettings(pluginId), pageSize: 7 };
			const updated = yield* updateSavedView(client, stored.reference, {
				settings,
				dataSources: alternateDataSources,
			});
			const fetched = yield* getSavedView(client, stored.reference);

			expect(updated.id).toBe(created.id);
			expect(fetched.settings).toEqual(settings);
			assertCondition(savedViewQuery.output.type === "rows", "Expected authored rows");
			expect(fetched.dataSources).toMatchObject({
				controls: alternateDataSources.controls,
				parameters: alternateDataSources.parameters,
			});
			expect(fetched.dataSources?.queries.savedView).toMatchObject({
				from: savedViewQuery.from,
				output: { ...savedViewQuery.output, fields: arrayContaining(savedViewQuery.output.fields) },
				where: {
					type: "and",
					predicates: arrayContaining([alternateDataSources.queries.savedView.where]),
				},
			});
			expect(fetched.dataSources?.queries.count?.output.type).toBe("aggregate");
			expect(fetched.dataSources?.queries.ids?.output.type).toBe("rows");
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
			const dataSources = {
				...buildSavedViewDataSources(["does-not-exist"], { pluginId, kind: "local" }),
				controls: {
					filter: {
						alias: "entity",
						kind: "browse" as const,
						schemas: [{ slug: "book", owner: { pluginId, kind: "local" as const } }] as const,
					},
				},
			};
			const created = yield* createSavedView(client, {
				dataSources,
				name: `Unknown Schema View ${yield* randomUuid}`,
			});

			const stored = yield* findSavedViewById(client, created.id);
			expect(stored.dataSources?.queries.savedView?.where).toMatchObject({
				type: "and",
				predicates: arrayContaining([dataSources.queries.savedView?.where]),
			});
			expect(stored.dataSources?.queries.count?.output.type).toBe("aggregate");
			expect(stored.dataSources?.queries.ids?.output.type).toBe("rows");
			expect(stored.renderer).toEqual({ kind: "kernel", name: "entity-browser" });
		}),
	);
});
