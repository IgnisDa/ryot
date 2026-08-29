import type { ContractSuccess } from "@ryot-app/contract/client";
import { savedViewRecipe } from "@ryot-app/ryotql-recipes/saved-views";
import { Effect } from "effect";

import {
	cloneSavedView,
	createAuthenticatedClient,
	createPluginEntitySchema,
	createSavedView,
	createSavedViewWithGridDocument,
	deleteSavedView,
	findBuiltinSavedView,
	getSavedView,
	listSavedViews,
	reorderSavedViews,
	rowsDocument,
	rowsFields,
	rowsLayouts,
	updateSavedViewWithGridDocument,
} from "~/fixtures/kernel";
import { assertPresent, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const schemaRowsDocument = (slug: string) =>
	savedViewRecipe({
		layout: { type: "card", mapping: rowsLayouts.grid },
		source: {
			type: "generated",
			limit: 2,
			entitySchemaSlugs: [slug],
			fields: rowsFields,
		},
	}).document;

type SavedViewUpdateSource =
	| Effect.Success<ReturnType<typeof getSavedView>>
	| ContractSuccess<"savedViews", "update">;

const buildBuiltinUpdatePayload = (view: SavedViewUpdateSource) => {
	const layouts = requirePresent(view.layouts, "Built-in saved view has no layouts");
	return {
		layouts,
		icon: view.icon,
		name: view.name,
		isDisabled: view.isDisabled,
		entitySchemaSlug: view.entitySchemaSlug,
		...(view.pluginSlug ? { pluginSlug: view.pluginSlug } : {}),
	};
};

describe("saved views management", () => {
	it.live("lists built-in and user-created views together", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createdView = yield* createSavedView(client, {
				name: `Managed View ${crypto.randomUUID()}`,
			});

			const views = yield* listSavedViews(client);
			const listedCreatedView = views.find((view) => view.id === createdView.id);
			expect(views.some((view) => view.isBuiltin)).toBe(true);
			expect(views.map((view) => view.id)).toContain(createdView.id);
			expect(createdView.entitySchemaSlug).toBe("book");
			expect(listedCreatedView?.entitySchemaSlug).toBe("book");
		}),
	);

	it.live("seeds the All Collections built-in view against the collection schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const views = yield* listSavedViews(client);
			const collectionsView = views.find((view) => view.name === "All Collections");

			expect(collectionsView).toMatchObject({
				isBuiltin: true,
				entitySchemaSlug: null,
				name: "All Collections",
				layouts: {
					grid: {
						queryDocument: {
							queries: { savedView: { from: { table: "entity", alias: "entity" } } },
						},
					},
				},
			});
		}),
	);

	it.live("supports the full create-get-update-clone-delete lifecycle", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createdView = yield* createSavedViewWithGridDocument(client, rowsDocument, {
				name: `Lifecycle View ${crypto.randomUUID()}`,
			});
			const fetchedView = yield* getSavedView(client, createdView.slug);

			expect(fetchedView.id).toBe(createdView.id);
			expect(fetchedView.entitySchemaSlug).toBe("book");
			expect(fetchedView.isBuiltin).toBe(false);

			const updatedView = yield* updateSavedViewWithGridDocument(
				client,
				createdView.slug,
				rowsDocument,
				{ name: `${createdView.name} Updated` },
			);
			const updatedViewLayouts = requirePresent(
				updatedView.layouts,
				"Updated saved view has no layouts",
			);
			const createdViewLayouts = requirePresent(
				createdView.layouts,
				"Created saved view has no layouts",
			);
			expect(updatedView.entitySchemaSlug).toBe("book");
			expect(updatedViewLayouts.grid.queryDocument).toEqual(rowsDocument);
			expect(updatedViewLayouts.list).toEqual(createdViewLayouts.list);
			expect(updatedViewLayouts.table).toEqual(createdViewLayouts.table);

			const clonedView = yield* cloneSavedView(client, createdView.slug);
			expect(clonedView.id).not.toBe(createdView.id);
			expect(clonedView.entitySchemaSlug).toBe("book");
			expect(clonedView.name).toBe(`${createdView.name} Updated (Copy)`);
			expect(clonedView.layouts).toEqual(updatedView.layouts);

			const deletedOriginal = yield* deleteSavedView(client, createdView.slug);
			const deletedClone = yield* deleteSavedView(client, clonedView.slug);
			const remainingViews = yield* listSavedViews(client);
			const remainingIds = remainingViews.map((view) => view.id);

			expect(deletedOriginal.id).toBe(createdView.id);
			expect(deletedClone.id).toBe(clonedView.id);
			expect(remainingIds).not.toContain(createdView.id);
			expect(remainingIds).not.toContain(clonedView.id);
		}),
	);

	it.live("clones a built-in view into a deletable user view", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinView = (yield* listSavedViews(client)).find(
				(view) => view.name === "All Movies",
			);
			assertPresent(builtinView, "Expected the All Movies built-in saved view");
			const clonedView = yield* cloneSavedView(client, builtinView.slug);

			expect(clonedView.name).toBe(`${builtinView.name} (Copy)`);
			expect(clonedView.entitySchemaSlug).toBe("movie");
			expect(clonedView.isBuiltin).toBe(false);

			const deletedClone = yield* deleteSavedView(client, clonedView.slug);
			const refreshedBuiltin = yield* getSavedView(client, builtinView.slug);
			expect(deletedClone.id).toBe(clonedView.id);
			expect(refreshedBuiltin.id).toBe(builtinView.id);
		}),
	);

	it.live("rejects deletes for built-in views", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinView = yield* findBuiltinSavedView(client);

			const error = yield* Effect.flip(
				client.call((c) => c.savedViews.delete({ params: { viewSlug: builtinView.slug } })),
			);

			expect(error).toMatchObject({
				_tag: "SavedViewBadRequest",
				reason: { code: "builtin-view-immutable", viewSlug: builtinView.slug },
			});
		}),
	);

	it.live("rejects built-in updates that change fields other than isDisabled", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinView = yield* findBuiltinSavedView(client);

			const invalidUpdateError = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.update({
						params: { viewSlug: builtinView.slug },
						payload: {
							...buildBuiltinUpdatePayload(builtinView),
							name: `${builtinView.name} Renamed`,
						},
					}),
				),
			);
			expect(invalidUpdateError).toMatchObject({
				_tag: "SavedViewBadRequest",
				reason: { code: "builtin-view-immutable", viewSlug: builtinView.slug },
			});

			const disabledView = yield* client.call((c) =>
				c.savedViews.update({
					params: { viewSlug: builtinView.slug },
					payload: { ...buildBuiltinUpdatePayload(builtinView), isDisabled: true },
				}),
			);
			expect(disabledView.isDisabled).toBe(true);

			const reenabledView = yield* client.call((c) =>
				c.savedViews.update({
					params: { viewSlug: builtinView.slug },
					payload: { ...buildBuiltinUpdatePayload(disabledView), isDisabled: false },
				}),
			);
			expect(reenabledView.isDisabled).toBe(false);
			expect(reenabledView.entitySchemaSlug).toBe(builtinView.entitySchemaSlug);
		}),
	);

	it.live("toggles isDisabled on user views and respects list filtering", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createdView = yield* createSavedViewWithGridDocument(client, rowsDocument, {
				name: `Disabled View ${crypto.randomUUID()}`,
			});

			yield* updateSavedViewWithGridDocument(client, createdView.slug, rowsDocument, {
				name: createdView.name,
				isDisabled: true,
			});

			const enabledViews = yield* listSavedViews(client);
			const allViews = yield* listSavedViews(client, { includeDisabled: true });

			expect(enabledViews.map((view) => view.id)).not.toContain(createdView.id);
			expect(allViews.map((view) => view.id)).toContain(createdView.id);
		}),
	);

	it.live("filters views by plugin and reorders them within the requested scope", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginSlug, slug } = yield* createPluginEntitySchema(client, {
				schemaName: `SavedViewTracked ${crypto.randomUUID()}`,
			});
			const viewDocument = schemaRowsDocument(slug);

			const trackerViewA = yield* createSavedViewWithGridDocument(client, viewDocument, {
				entitySchemaSlug: slug,
				pluginSlug,
				name: `Tracker View A ${crypto.randomUUID()}`,
			});
			const trackerViewB = yield* createSavedViewWithGridDocument(client, viewDocument, {
				entitySchemaSlug: slug,
				pluginSlug,
				name: `Tracker View B ${crypto.randomUUID()}`,
			});
			const trackerViewC = yield* createSavedViewWithGridDocument(client, viewDocument, {
				entitySchemaSlug: slug,
				pluginSlug,
				name: `Tracker View C ${crypto.randomUUID()}`,
			});
			yield* createSavedView(client, { name: `Top Level View ${crypto.randomUUID()}` });

			const pluginViews = yield* listSavedViews(client, { pluginSlug });
			expect(pluginViews.map((view) => view.id)).toContain(trackerViewA.id);
			expect(pluginViews.map((view) => view.id)).toContain(trackerViewB.id);
			expect(pluginViews.map((view) => view.id)).toContain(trackerViewC.id);

			const reordered = yield* reorderSavedViews(client, {
				pluginSlug,
				viewSlugs: [trackerViewC.slug, trackerViewA.slug],
			});
			expect(reordered.viewSlugs[0]).toBe(trackerViewC.slug);
			expect(reordered.viewSlugs[1]).toBe(trackerViewA.slug);
			expect(reordered.viewSlugs).toContain(trackerViewB.slug);

			const reorderedViews = yield* listSavedViews(client, { pluginSlug });
			expect(reorderedViews[0]?.slug).toBe(trackerViewC.slug);
			expect(reorderedViews[1]?.slug).toBe(trackerViewA.slug);
			expect(reorderedViews.map((view) => view.slug)).toContain(trackerViewB.slug);
			expect(reorderedViews.every((view) => view.pluginSlug === pluginSlug)).toBe(true);
			expect(reorderedViews.every((view) => view.entitySchemaSlug === slug)).toBe(true);
		}),
	);
});
