import { buildSavedViewDocument } from "@ryot/ryotql-recipes/saved-views";
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
	updateSavedViewWithGridDocument,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

const buildSchemaRowsDocument = (slug: string) =>
	buildSavedViewDocument({
		page: 1,
		limit: 2,
		entitySchemaSlugs: [slug],
		fields: rowsFields,
	});

const buildBuiltinUpdatePayload = (view: Effect.Success<ReturnType<typeof getSavedView>>) => ({
	icon: view.icon,
	name: view.name,
	isDisabled: view.isDisabled,
	layouts: view.layouts,
	...(view.pluginSlug ? { pluginSlug: view.pluginSlug } : {}),
});

describe("saved views management", () => {
	it.live("lists built-in and user-created views together", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createdView = yield* createSavedView(client, {
				name: `Managed View ${crypto.randomUUID()}`,
			});

			const views = yield* listSavedViews(client);
			expect(views.some((view) => view.isBuiltin)).toBe(true);
			expect(views.map((view) => view.id)).toContain(createdView.id);
		}),
	);

	it.live("seeds the All Collections built-in view against the collection schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const views = yield* listSavedViews(client);
			const collectionsView = views.find((view) => view.name === "All Collections");

			expect(collectionsView).toMatchObject({
				isBuiltin: true,
				name: "All Collections",
				layouts: {
					grid: {
						queryDocument: {
							queries: { collections: { from: { table: "entity", alias: "collection" } } },
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
			expect(fetchedView.isBuiltin).toBe(false);

			const updatedView = yield* updateSavedViewWithGridDocument(
				client,
				createdView.slug,
				rowsDocument,
				{ name: `${createdView.name} Updated` },
			);
			expect(updatedView.layouts.grid.queryDocument).toEqual(rowsDocument);
			expect(updatedView.layouts.list).toEqual(createdView.layouts.list);
			expect(updatedView.layouts.table).toEqual(createdView.layouts.table);

			const clonedView = yield* cloneSavedView(client, createdView.slug);
			expect(clonedView.id).not.toBe(createdView.id);
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
			const builtinView = yield* findBuiltinSavedView(client);
			const clonedView = yield* cloneSavedView(client, builtinView.slug);

			expect(clonedView.name).toBe(`${builtinView.name} (Copy)`);
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

			expect(error).toMatchObject({ _tag: "BadRequest" });
			expect(error.message).toBe("Cannot modify built-in saved views");
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
			expect(invalidUpdateError).toMatchObject({ _tag: "BadRequest" });

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
			const viewDocument = buildSchemaRowsDocument(slug);

			const trackerViewA = yield* createSavedViewWithGridDocument(client, viewDocument, {
				pluginSlug,
				name: `Tracker View A ${crypto.randomUUID()}`,
			});
			const trackerViewB = yield* createSavedViewWithGridDocument(client, viewDocument, {
				pluginSlug,
				name: `Tracker View B ${crypto.randomUUID()}`,
			});
			const trackerViewC = yield* createSavedViewWithGridDocument(client, viewDocument, {
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
		}),
	);
});
