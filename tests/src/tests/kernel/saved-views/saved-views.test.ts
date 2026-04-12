import { column, eq, literal, table } from "@ryot/ryotql";
import { buildSavedViewDocument } from "@ryot/ryotql-recipes/saved-views";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	buildSavedViewLayouts,
	createSavedViewWithGridDocument,
	findBuiltinPluginBySlug,
	getSavedView,
	listSavedViews,
	rowsDocument,
	rowsFields,
	rowsLayouts,
	updateSavedViewWithGridDocument,
} from "~/fixtures";
import { assertCondition, assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const entity = table("entity", "entity");

const alternateRowsDocument = buildSavedViewDocument({
	limit: 2,
	entitySchemaSlugs: ["book"],
	where: eq(column(entity, "name"), literal("A Book")),
	fields: rowsFields,
});

describe("Saved views query documents E2E", () => {
	it.live("stores media built-in saved views with canonical in-library filters", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const mediaPlugin = yield* findBuiltinPluginBySlug(client, "media");
			const views = yield* listSavedViews(client, { pluginSlug: mediaPlugin.slug });
			const allBooksView = views.find((view) => view.name === "All Books");

			expect(allBooksView?.layouts.grid.queryDocument).toMatchObject({
				queries: {
					savedView: {
						from: { alias: "entity", table: "entity" },
						output: {
							type: "rows",
							pagination: { limit: 20 },
							fields: expect.arrayContaining([
								expect.objectContaining({ key: "entityId" }),
								expect.objectContaining({ key: "title" }),
							]),
						},
						where: {
							type: "and",
							predicates: expect.arrayContaining([
								expect.objectContaining({
									type: "comparison",
									right: { type: "literal", value: "book" },
									left: expect.objectContaining({
										tableAlias: "entity",
										field: "entitySchemaSlug",
									}),
								}),
								expect.objectContaining({ type: "exists" }),
							]),
						},
					},
				},
			});
		}),
	);

	it.live("creates and retrieves a saved view with a key-based rows definition", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const createdView = yield* createSavedViewWithGridDocument(client, rowsDocument, {
				name: `Rows View ${crypto.randomUUID()}`,
			});
			const fetchedView = yield* getSavedView(client, createdView.slug);

			expect(createdView.layouts).toEqual(rowsLayouts);
			expect(fetchedView.layouts).toEqual(rowsLayouts);
			expect(fetchedView.layouts.grid.entityIdField).toBe("entityId");
			expect(fetchedView.layouts.grid.titleField).toBe("title");
			expect(fetchedView.layouts.list.titleField).toBe("title");
			expect(fetchedView.layouts.table.columns[0].field).toBe("column0");
		}),
	);

	it.live("updates a saved view's explicit rows query document", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createdView = yield* createSavedViewWithGridDocument(client, rowsDocument, {
				name: `Updatable View ${crypto.randomUUID()}`,
			});

			const updatedView = yield* updateSavedViewWithGridDocument(
				client,
				createdView.slug,
				alternateRowsDocument,
			);
			const fetchedView = yield* getSavedView(client, createdView.slug);

			expect(updatedView.layouts.grid.queryDocument).toEqual(alternateRowsDocument);
			expect(fetchedView.layouts.grid.queryDocument).toEqual(alternateRowsDocument);
			expect(fetchedView.layouts.list).toEqual(rowsLayouts.list);
			expect(fetchedView.layouts.table).toEqual(rowsLayouts.table);
		}),
	);

	it.live("preserves explicit fields and display keys without nested results", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createdView = yield* createSavedViewWithGridDocument(client, rowsDocument, {
				name: `Projected View ${crypto.randomUUID()}`,
			});
			const fetchedView = yield* getSavedView(client, createdView.slug);
			const query = fetchedView.layouts.grid.queryDocument.queries.savedView;
			assertPresent(query, "Expected the saved-view query");
			assertCondition(
				query.output.type === "rows",
				"Expected the saved-view query to use rows output",
			);
			const output = query.output;

			expect(output.type).toBe("rows");
			expect(output.include).toBeUndefined();
			expect(output.fields.every((selection) => "key" in selection)).toBe(true);
			expect(output.fields.map((selection) => "key" in selection && selection.key)).toEqual(
				expect.arrayContaining(["entityId", "title", "image"]),
			);
		}),
	);

	it.live("accepts an unknown entity discriminator as an empty saved view", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const layouts = buildSavedViewLayouts({}, ["does-not-exist"]);
			const createdView = yield* createSavedViewWithGridDocument(
				client,
				layouts.grid.queryDocument,
				{
					layouts,
					name: `Unknown Entity Schema View ${crypto.randomUUID()}`,
				},
			);

			expect(createdView.layouts).toEqual(layouts);
		}),
	);
});
