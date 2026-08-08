import { Effect } from "effect";

import {
	buildUpdatedSavedViewBody,
	cloneSavedView,
	createAuthenticatedClient,
	createPluginScope,
	createSavedView,
	deleteSavedView,
	findBuiltinSavedView,
	findSavedViewById,
	getSavedView,
	installPrivatePlugin,
	listSavedViews,
	PRIVATE_PLUGIN_CONFIG_KEY,
	reorderSavedViews,
	type Client,
	updateSavedView,
} from "~/fixtures/kernel";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const missingViewSlug = "non-existent-view-slug";

const installPluginScope = Effect.fn(function* (client: Client) {
	const pluginSlug = createPluginScope();
	yield* installPrivatePlugin({
		client,
		pluginSlug,
		config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "saved-view-scope" },
	});
	return pluginSlug;
});

describe("Saved views lifecycle E2E", () => {
	it.live("lists built-in and user-created views together", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createdView = yield* createSavedView(client, {
				name: `List Coverage ${crypto.randomUUID()}`,
			});
			const listedViews = yield* listSavedViews(client);
			const listedViewIds = listedViews.map((view) => view.id);
			expect(listedViews.some((view) => view.isBuiltin)).toBe(true);
			expect(listedViewIds).toContain(createdView.id);
			expect(listedViews.find((view) => view.id === createdView.id)?.renderer).toEqual({
				kind: "kernel",
				name: "entity-browser",
			});
		}),
	);

	it.live("seeds the All Collections built-in view against the collection schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const views = yield* listSavedViews(client);
			const collectionsView = views.find((view) => view.name === "All Collections");
			expect(collectionsView).toBeDefined();
			expect(collectionsView).toMatchObject({
				icon: "folders",
				isBuiltin: true,
				name: "All Collections",
			});
			expect(collectionsView?.renderer).toEqual({ kind: "kernel", name: "entity-browser" });
			expect(collectionsView?.settings).toMatchObject({
				sourceName: "savedView",
				entityIdField: "entityId",
				entitySchemaSlugField: "entitySchemaSlug",
			});
			expect(collectionsView?.dataSources).toMatchObject({
				queries: {
					savedView: {
						where: {
							right: { type: "literal", value: "collection" },
							left: { tableAlias: "entity", field: "entitySchemaSlug" },
						},
					},
				},
			});
		}),
	);

	it.live("persists built-in view state on the materialized view row", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinView = yield* findBuiltinSavedView(client);
			yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)));
			const updatedView = yield* client.call((c) =>
				c.savedViews.update({
					params: { viewSlug: builtinView.slug },
					payload: {
						isDisabled: true,
						icon: builtinView.icon,
						name: builtinView.name,
						renderer: builtinView.renderer,
						settings: builtinView.settings,
						dataSources: builtinView.dataSources,
						...(builtinView.pluginSlug ? { workspacePluginSlug: builtinView.pluginSlug } : {}),
					},
				}),
			);
			const fetchedView = yield* getSavedView(client, builtinView.slug);

			expect(updatedView.id).toBe(builtinView.id);
			expect(fetchedView.renderer).toEqual(builtinView.renderer);
			expect(fetchedView.createdAt).toBe(builtinView.createdAt);
			expect(fetchedView.updatedAt).not.toBe(builtinView.updatedAt);
			expect(fetchedView.isDisabled).toBe(true);
		}),
	);

	it.live("supports the full create-get-update-clone-delete lifecycle", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createSavedView(client, { name: "Lifecycle View" });
			const createdView = yield* findSavedViewById(client, created.id);
			const fetchedView = yield* getSavedView(client, createdView.slug);
			expect(fetchedView.id).toBe(createdView.id);
			expect(fetchedView.renderer).toEqual(createdView.renderer);
			expect(fetchedView.settings).toEqual(createdView.settings);
			expect(fetchedView.dataSources).toEqual(createdView.dataSources);
			expect(fetchedView.name).toBe("Lifecycle View");
			expect(fetchedView.isBuiltin).toBe(false);
			expect(fetchedView.isDisabled).toBe(false);
			expect(Number.isNaN(Date.parse(fetchedView.createdAt))).toBe(false);
			expect(Number.isNaN(Date.parse(fetchedView.updatedAt))).toBe(false);

			const cloned = yield* cloneSavedView(client, createdView.slug);
			const clonedView = yield* findSavedViewById(client, cloned.id);
			expect(clonedView.id).not.toBe(createdView.id);
			expect(clonedView.name).toBe("Lifecycle View (Copy)");
			expect(clonedView.isBuiltin).toBe(false);
			expect(clonedView.renderer).toEqual(createdView.renderer);
			expect(clonedView.settings).toEqual(createdView.settings);
			expect(clonedView.dataSources).toEqual(createdView.dataSources);
			const updatedClone = yield* updateSavedView(client, clonedView.slug, {
				name: "Lifecycle View Revised",
			});
			const fetchedUpdated = yield* getSavedView(client, clonedView.slug);
			expect(updatedClone.id).toBe(clonedView.id);
			expect(fetchedUpdated.name).toBe("Lifecycle View Revised");
			expect(fetchedUpdated.renderer).toEqual(createdView.renderer);
			expect(fetchedUpdated.id).toBe(clonedView.id);
			const deletedOriginal = yield* deleteSavedView(client, createdView.slug);
			const deletedClone = yield* deleteSavedView(client, clonedView.slug);
			const remaining = yield* listSavedViews(client);
			const remainingIds = remaining.map((v) => v.id);
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
			const cloned = yield* cloneSavedView(client, builtinView.slug);
			const clonedView = yield* findSavedViewById(client, cloned.id);
			expect(clonedView.name).toBe(`${builtinView.name} (Copy)`);
			expect(clonedView.isBuiltin).toBe(false);
			expect(clonedView.renderer).toEqual(builtinView.renderer);
			expect(clonedView.settings).toEqual(builtinView.settings);
			expect(clonedView.dataSources).toEqual(builtinView.dataSources);
			const deletedClone = yield* deleteSavedView(client, clonedView.slug);
			const refreshedBuiltin = yield* getSavedView(client, builtinView.slug);
			const remaining = yield* listSavedViews(client);
			const remainingIds = remaining.map((v) => v.id);
			expect(deletedClone.id).toBe(clonedView.id);
			expect(refreshedBuiltin.id).toBe(builtinView.id);
			expect(remainingIds).not.toContain(clonedView.id);
		}),
	);

	it.live("rejects deletes for built-in views", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinView = yield* findBuiltinSavedView(client);
			const error = yield* Effect.flip(
				client.call((c) => c.savedViews.delete({ params: { viewSlug: builtinView.slug } })),
			);
			assertTaggedError(error, "SavedViewBadRequest");
			expect(error.reason).toEqual({ viewSlug: builtinView.slug, code: "builtin-view-immutable" });
		}),
	);

	it.live("rejects built-in updates that attempt to change fields other than isDisabled", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinView = yield* findBuiltinSavedView(client);
			const invalidUpdateError = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.update({
						params: { viewSlug: builtinView.slug },
						payload: buildUpdatedSavedViewBody({ isDisabled: true, name: "Attempted Rename" }),
					}),
				),
			);

			assertTaggedError(invalidUpdateError, "SavedViewBadRequest");
			expect(invalidUpdateError.reason).toEqual({
				viewSlug: builtinView.slug,
				code: "builtin-view-immutable",
			});

			const disableResult = yield* client.call((c) =>
				c.savedViews.update({
					params: { viewSlug: builtinView.slug },
					payload: {
						isDisabled: true,
						icon: builtinView.icon,
						name: builtinView.name,
						renderer: builtinView.renderer,
						settings: builtinView.settings,
						dataSources: builtinView.dataSources,
						...(builtinView.pluginSlug ? { workspacePluginSlug: builtinView.pluginSlug } : {}),
					},
				}),
			);
			const refreshedDisabled = yield* getSavedView(client, builtinView.slug);
			expect(disableResult.id).toBe(builtinView.id);
			expect(refreshedDisabled.isDisabled).toBe(true);
			expect(refreshedDisabled.renderer).toEqual(builtinView.renderer);

			yield* client.call((c) =>
				c.savedViews.update({
					params: { viewSlug: builtinView.slug },
					payload: {
						isDisabled: false,
						icon: builtinView.icon,
						name: builtinView.name,
						renderer: builtinView.renderer,
						settings: builtinView.settings,
						dataSources: builtinView.dataSources,
						...(builtinView.pluginSlug ? { workspacePluginSlug: builtinView.pluginSlug } : {}),
					},
				}),
			);
			const fetchedReEnabled = yield* getSavedView(client, builtinView.slug);

			expect(fetchedReEnabled.isDisabled).toBe(false);
			expect(fetchedReEnabled.settings).toEqual(builtinView.settings);
			expect(fetchedReEnabled.name).toBe(builtinView.name);
		}),
	);

	it.live("returns 404 for missing views across update, clone, and delete", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const updateError = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.update({
						payload: buildUpdatedSavedViewBody(),
						params: { viewSlug: missingViewSlug },
					}),
				),
			);
			const cloneError = yield* Effect.flip(
				client.call((c) => c.savedViews.clone({ params: { viewSlug: missingViewSlug } })),
			);
			const deleteError = yield* Effect.flip(
				client.call((c) => c.savedViews.delete({ params: { viewSlug: missingViewSlug } })),
			);

			for (const error of [updateError, cloneError, deleteError]) {
				assertTaggedError(error, "SavedViewNotFound");
				expect(error.reason).toEqual({ viewSlug: missingViewSlug, code: "saved-view-not-found" });
			}
		}),
	);

	it.live("preserves immutable fields when updating user views", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createSavedView(client, { name: "Immutable Fields View" });
			const createdView = yield* findSavedViewById(client, created.id);

			yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)));
			yield* updateSavedView(client, createdView.slug, { name: "Immutable Fields View Updated" });
			const refreshedView = yield* getSavedView(client, createdView.slug);

			expect(refreshedView.id).toBe(createdView.id);
			expect(refreshedView.renderer).toEqual(createdView.renderer);
			expect(refreshedView.isBuiltin).toBe(false);
			expect(refreshedView.createdAt).toBe(createdView.createdAt);
			expect(refreshedView.updatedAt).not.toBe(createdView.updatedAt);
		}),
	);

	it.live("supports toggling isDisabled on user views", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createSavedView(client, { name: "Disable Toggle View" });
			const createdView = yield* findSavedViewById(client, created.id);

			expect(createdView.isDisabled).toBe(false);

			const disabled = yield* updateSavedView(client, createdView.slug, { isDisabled: true });
			const fetchedDisabled = yield* getSavedView(client, createdView.slug);

			expect(disabled.id).toBe(createdView.id);
			expect(fetchedDisabled.isDisabled).toBe(true);

			const reEnabled = yield* updateSavedView(client, createdView.slug, { isDisabled: false });
			const fetchedReEnabled = yield* getSavedView(client, createdView.slug);

			expect(reEnabled.id).toBe(createdView.id);
			expect(fetchedReEnabled.isDisabled).toBe(false);
			expect(fetchedReEnabled.dataSources).toEqual(createdView.dataSources);
		}),
	);

	it.live("lists only enabled saved views by default", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createSavedView(client, {
				name: `Filtered View ${crypto.randomUUID()}`,
			});
			const createdView = yield* findSavedViewById(client, created.id);

			yield* updateSavedView(client, createdView.slug, { isDisabled: true });

			const listedViews = yield* listSavedViews(client);

			expect(listedViews.map((view) => view.id)).not.toContain(createdView.id);
			expect(listedViews.every((view) => !view.isDisabled)).toBe(true);
		}),
	);

	it.live(
		"includes disabled saved views when includeDisabled is true and respects plugin filters",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const pluginSlug = yield* installPluginScope(client);
				const enabledCreated = yield* createSavedView(client, {
					workspacePluginSlug: pluginSlug,
					name: `Enabled Tracked ${crypto.randomUUID()}`,
				});
				const enabledTracked = yield* findSavedViewById(client, enabledCreated.id);
				const disabledCreated = yield* createSavedView(client, {
					workspacePluginSlug: pluginSlug,
					name: `Disabled Tracked ${crypto.randomUUID()}`,
				});
				const disabledTracked = yield* findSavedViewById(client, disabledCreated.id);
				yield* createSavedView(client, { name: `Standalone ${crypto.randomUUID()}` });
				yield* updateSavedView(client, disabledTracked.slug, {
					isDisabled: true,
					workspacePluginSlug: pluginSlug,
				});

				const listedViews = yield* listSavedViews(client, { pluginSlug, includeDisabled: true });

				expect(new Set(listedViews.map((v) => v.id))).toEqual(
					new Set([disabledTracked.id, enabledTracked.id]),
				);
				expect(listedViews.map((v) => v.pluginSlug)).toEqual([pluginSlug, pluginSlug]);
				expect(listedViews.some((v) => v.isDisabled)).toBe(true);
			}),
	);

	it.live("reorders saved views only within the requested plugin scope", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const pluginSlug = yield* installPluginScope(client);
			const firstCreated = yield* createSavedView(client, {
				workspacePluginSlug: pluginSlug,
				name: `Tracker View A ${crypto.randomUUID()}`,
			});
			const first = yield* findSavedViewById(client, firstCreated.id);
			const secondCreated = yield* createSavedView(client, {
				workspacePluginSlug: pluginSlug,
				name: `Tracker View B ${crypto.randomUUID()}`,
			});
			const second = yield* findSavedViewById(client, secondCreated.id);
			const standalone = yield* createSavedView(client, {
				name: `Standalone View ${crypto.randomUUID()}`,
			});

			const reordered = yield* reorderSavedViews(client, {
				pluginSlug,
				viewSlugs: [second.slug, first.slug],
			});
			const scopedViews = yield* listSavedViews(client, { pluginSlug, includeDisabled: true });
			const topLevelViews = yield* listSavedViews(client, { includeDisabled: true });

			expect(reordered.viewSlugs.slice(0, 2)).toEqual([second.slug, first.slug]);
			expect(scopedViews.map((v) => v.slug).slice(0, 2)).toEqual([second.slug, first.slug]);
			expect(topLevelViews.some((v) => v.id === standalone.id)).toBe(true);
		}),
	);

	it.live("reorders only top-level saved views when pluginSlug is omitted", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const firstCreated = yield* createSavedView(client, {
				name: `Top View A ${crypto.randomUUID()}`,
			});
			const secondCreated = yield* createSavedView(client, {
				name: `Top View B ${crypto.randomUUID()}`,
			});
			const first = yield* findSavedViewById(client, firstCreated.id);
			const second = yield* findSavedViewById(client, secondCreated.id);
			const pluginSlug = yield* installPluginScope(client);
			const tracked = yield* createSavedView(client, {
				workspacePluginSlug: pluginSlug,
				name: `Tracked Scope View ${crypto.randomUUID()}`,
			});

			yield* reorderSavedViews(client, { viewSlugs: [second.slug, first.slug] });
			const topLevelViews = yield* listSavedViews(client, { includeDisabled: true });
			const trackedViews = yield* listSavedViews(client, { pluginSlug, includeDisabled: true });

			const orderedSlugs = topLevelViews
				.filter((v) => v.slug === first.slug || v.slug === second.slug)
				.map((v) => v.slug);

			expect(orderedSlugs).toEqual([second.slug, first.slug]);
			expect(trackedViews.some((v) => v.id === tracked.id)).toBe(true);
		}),
	);

	it.live("moves a saved view to top-level when pluginSlug is omitted on update", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const pluginSlug = yield* installPluginScope(client);
			const movedCreated = yield* createSavedView(client, {
				workspacePluginSlug: pluginSlug,
				name: `Movable View ${crypto.randomUUID()}`,
			});
			const movedView = yield* findSavedViewById(client, movedCreated.id);

			const updatedView = yield* updateSavedView(client, movedView.slug, {
				workspacePluginSlug: null,
				name: `${movedView.name} Updated`,
			});
			const fetchedView = yield* getSavedView(client, movedView.slug);
			const topLevelViews = yield* listSavedViews(client, { includeDisabled: true });
			const pluginViews = yield* listSavedViews(client, { pluginSlug, includeDisabled: true });

			expect(updatedView.id).toBe(movedView.id);
			expect(fetchedView.pluginSlug).toBeNull();
			expect(topLevelViews.map((v) => v.id)).toContain(movedView.id);
			expect(pluginViews.map((v) => v.id)).not.toContain(movedView.id);
		}),
	);

	it.live("reorders built-in and custom top-level views without altering their definitions", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinView = requirePresent(
				(yield* listSavedViews(client, { includeDisabled: true })).find(
					(view) => view.isBuiltin && view.pluginSlug === null,
				),
				"Top-level built-in saved view not found",
			);
			const customCreated = yield* createSavedView(client, {
				name: `Mixed Scope View ${crypto.randomUUID()}`,
			});
			const customView = yield* findSavedViewById(client, customCreated.id);

			const reordered = yield* reorderSavedViews(client, {
				viewSlugs: [customView.slug, builtinView.slug],
			});
			const topLevelViews = yield* listSavedViews(client, { includeDisabled: true });
			const reorderedBuiltin = yield* getSavedView(client, builtinView.slug);

			expect(reordered.viewSlugs.slice(0, 2)).toEqual([customView.slug, builtinView.slug]);
			expect(
				topLevelViews
					.filter((view) => view.pluginSlug === null)
					.map((view) => view.slug)
					.slice(0, 2),
			).toEqual([customView.slug, builtinView.slug]);
			expect(reorderedBuiltin).toMatchObject({
				isBuiltin: true,
				name: builtinView.name,
				icon: builtinView.icon,
				renderer: builtinView.renderer,
				settings: builtinView.settings,
				isDisabled: builtinView.isDisabled,
				dataSources: builtinView.dataSources,
			});
		}),
	);

	it.live("rejects reorder requests containing saved views from another scope", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const pluginSlug = yield* installPluginScope(client);
			const trackedCreated = yield* createSavedView(client, {
				workspacePluginSlug: pluginSlug,
				name: `Scoped View ${crypto.randomUUID()}`,
			});
			const tracked = yield* findSavedViewById(client, trackedCreated.id);
			const standaloneCreated = yield* createSavedView(client, {
				name: `Top Scope View ${crypto.randomUUID()}`,
			});
			const standalone = yield* findSavedViewById(client, standaloneCreated.id);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.reorder({
						payload: { pluginSlug, viewSlugs: [tracked.slug, standalone.slug] },
					}),
				),
			);

			assertTaggedError(error, "SavedViewBadRequest");
			expect(error.reason).toEqual({
				issue: "unknown-view",
				code: "invalid-reorder",
				viewSlugs: [tracked.slug, standalone.slug],
			});
		}),
	);
});
