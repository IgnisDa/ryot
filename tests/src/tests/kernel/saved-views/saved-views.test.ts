import { column, eq, literal, table } from "@ryot/ryotql";
import { buildSavedViewDocument } from "@ryot/ryotql-recipes/saved-views";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createSavedViewWithQueryDocument,
	findBuiltinPluginBySlug,
	getSavedView,
	listSavedViews,
	rowsDocument,
	rowsFields,
	updateSavedViewWithQueryDocument,
} from "~/fixtures";
import { assertCondition, assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const entity = table("entity", "entity");

const alternateRowsDocument = buildSavedViewDocument({
	page: 1,
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

			expect(allBooksView?.queryDocument).toMatchObject({
				queries: {
					savedView: {
						from: { alias: "entity", table: "entity" },
						output: {
							type: "rows",
							pagination: { page: 1 },
							fields: expect.arrayContaining([
								expect.objectContaining({ key: "entityId" }),
								expect.objectContaining({ key: "gridTitle" }),
								expect.objectContaining({ key: "listTitle" }),
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

			const createdView = yield* createSavedViewWithQueryDocument(client, rowsDocument, {
				name: `Rows View ${crypto.randomUUID()}`,
			});
			const fetchedView = yield* getSavedView(client, createdView.slug);

			expect(createdView.queryDocument).toEqual(rowsDocument);
			expect(fetchedView.queryDocument).toEqual(rowsDocument);
			expect(fetchedView.displayConfiguration.entityIdField).toBe("entityId");
			expect(fetchedView.displayConfiguration.grid.titleField).toBe("gridTitle");
			expect(fetchedView.displayConfiguration.list.titleField).toBe("listTitle");
			expect(fetchedView.displayConfiguration.table.columns[0].field).toBe("tableColumn0");
		}),
	);

	it.live("updates a saved view's explicit rows query document", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createdView = yield* createSavedViewWithQueryDocument(client, rowsDocument, {
				name: `Updatable View ${crypto.randomUUID()}`,
			});

			const updatedView = yield* updateSavedViewWithQueryDocument(
				client,
				createdView.slug,
				alternateRowsDocument,
			);
			const fetchedView = yield* getSavedView(client, createdView.slug);

			expect(updatedView.queryDocument).toEqual(alternateRowsDocument);
			expect(fetchedView.queryDocument).toEqual(alternateRowsDocument);
		}),
	);

	it.live("preserves explicit fields and display keys without nested results", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createdView = yield* createSavedViewWithQueryDocument(client, rowsDocument, {
				name: `Projected View ${crypto.randomUUID()}`,
			});
			const fetchedView = yield* getSavedView(client, createdView.slug);
			const query = fetchedView.queryDocument.queries.savedView;
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
				expect.arrayContaining(["entityId", "gridTitle", "listTitle", "tableColumn0"]),
			);
		}),
	);

	it.live("accepts an unknown entity discriminator as an empty saved view", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const documentWithUnknownSchema = buildSavedViewDocument({
				page: 1,
				limit: 2,
				entitySchemaSlugs: ["does-not-exist"],
				fields: rowsFields,
			});

			const createdView = yield* createSavedViewWithQueryDocument(
				client,
				documentWithUnknownSchema,
				{ name: `Unknown Entity Schema View ${crypto.randomUUID()}` },
			);

			expect(createdView.queryDocument).toEqual(documentWithUnknownSchema);
		}),
	);
});
