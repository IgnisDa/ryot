import { Effect } from "effect";

import {
	buildUpdatedSavedViewBody,
	cloneSavedView,
	createAuthenticatedClient,
	createSavedView,
	createPluginScope,
	deleteSavedView,
	findBuiltinSavedView,
	getSavedView,
	listSavedViews,
	reorderSavedViews,
	updateSavedView,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const builtinViewError = "Cannot modify built-in saved views";
const missingViewSlug = "non-existent-view-slug";

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
			expect(collectionsView?.queryDocument).toMatchObject({
				queries: {
					collections: {
						where: {
							right: { type: "literal", value: "collection" },
							left: { field: "entitySchemaSlug", tableAlias: "collection" },
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
						queryDocument: builtinView.queryDocument,
						displayConfiguration: builtinView.displayConfiguration,
						...(builtinView.pluginSlug ? { pluginSlug: builtinView.pluginSlug } : {}),
					},
				}),
			);
			const fetchedView = yield* getSavedView(client, builtinView.slug);

			expect(updatedView.id).toBe(builtinView.id);
			expect(fetchedView.createdAt).toBe(builtinView.createdAt);
			expect(fetchedView.updatedAt).not.toBe(builtinView.updatedAt);
			expect(fetchedView.isDisabled).toBe(true);
		}),
	);

	it.live("supports the full create-get-update-clone-delete lifecycle", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createdView = yield* createSavedView(client, { name: "Lifecycle View" });
			const fetchedView = yield* getSavedView(client, createdView.slug);
			expect(fetchedView.id).toBe(createdView.id);
			expect(fetchedView.name).toBe("Lifecycle View");
			expect(fetchedView.isBuiltin).toBe(false);
			expect(fetchedView.isDisabled).toBe(false);
			expect(Number.isNaN(Date.parse(fetchedView.createdAt))).toBe(false);
			expect(Number.isNaN(Date.parse(fetchedView.updatedAt))).toBe(false);

			const clonedView = yield* cloneSavedView(client, createdView.slug);
			expect(clonedView.id).not.toBe(createdView.id);
			expect(clonedView.name).toBe("Lifecycle View (Copy)");
			expect(clonedView.isBuiltin).toBe(false);
			const updatedClone = yield* updateSavedView(client, clonedView.slug, {
				name: "Lifecycle View Revised",
			});
			const fetchedUpdated = yield* getSavedView(client, clonedView.slug);
			expect(updatedClone.name).toBe("Lifecycle View Revised");
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
			const clonedView = yield* cloneSavedView(client, builtinView.slug);
			expect(clonedView.name).toBe(`${builtinView.name} (Copy)`);
			expect(clonedView.isBuiltin).toBe(false);
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
			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe(builtinViewError);
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

			assertTaggedError(invalidUpdateError, "BadRequest");
			expect(invalidUpdateError.message).toBe(builtinViewError);

			const disableResult = yield* client.call((c) =>
				c.savedViews.update({
					params: { viewSlug: builtinView.slug },
					payload: {
						isDisabled: true,
						icon: builtinView.icon,
						name: builtinView.name,
						queryDocument: builtinView.queryDocument,
						displayConfiguration: builtinView.displayConfiguration,
						...(builtinView.pluginSlug ? { pluginSlug: builtinView.pluginSlug } : {}),
					},
				}),
			);
			expect(disableResult.isDisabled).toBe(true);

			yield* client.call((c) =>
				c.savedViews.update({
					params: { viewSlug: builtinView.slug },
					payload: {
						isDisabled: false,
						icon: builtinView.icon,
						name: builtinView.name,
						queryDocument: builtinView.queryDocument,
						displayConfiguration: builtinView.displayConfiguration,
						...(builtinView.pluginSlug ? { pluginSlug: builtinView.pluginSlug } : {}),
					},
				}),
			);
			const fetchedReEnabled = yield* getSavedView(client, builtinView.slug);

			expect(fetchedReEnabled.isDisabled).toBe(false);
			expect(fetchedReEnabled.name).toBe(builtinView.name);
		}),
	);

	it.live("returns 404 for missing views across update, clone, and delete", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const updateError = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.update({
						params: { viewSlug: missingViewSlug },
						payload: buildUpdatedSavedViewBody(),
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
				assertTaggedError(error, "NotFound");
				expect(error.message).toBe("Saved view not found");
			}
		}),
	);

	it.live("preserves immutable fields when updating user views", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createdView = yield* createSavedView(client, { name: "Immutable Fields View" });

			yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)));
			yield* updateSavedView(client, createdView.slug, { name: "Immutable Fields View Updated" });
			const refreshedView = yield* getSavedView(client, createdView.slug);

			expect(refreshedView.id).toBe(createdView.id);
			expect(refreshedView.isBuiltin).toBe(false);
			expect(refreshedView.createdAt).toBe(createdView.createdAt);
			expect(refreshedView.updatedAt).not.toBe(createdView.updatedAt);
		}),
	);

	it.live("supports toggling isDisabled on user views", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createdView = yield* createSavedView(client, { name: "Disable Toggle View" });

			expect(createdView.isDisabled).toBe(false);

			const disabledView = yield* updateSavedView(client, createdView.slug, { isDisabled: true });
			const fetchedDisabled = yield* getSavedView(client, createdView.slug);

			expect(disabledView.isDisabled).toBe(true);
			expect(fetchedDisabled.isDisabled).toBe(true);

			const reEnabledView = yield* updateSavedView(client, createdView.slug, { isDisabled: false });
			const fetchedReEnabled = yield* getSavedView(client, createdView.slug);

			expect(reEnabledView.isDisabled).toBe(false);
			expect(fetchedReEnabled.isDisabled).toBe(false);
		}),
	);

	it.live("lists only enabled saved views by default", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createdView = yield* createSavedView(client, {
				name: `Filtered View ${crypto.randomUUID()}`,
			});

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
				const pluginSlug = createPluginScope();
				const enabledTracked = yield* createSavedView(client, {
					pluginSlug,
					name: `Enabled Tracked ${crypto.randomUUID()}`,
				});
				const disabledTracked = yield* createSavedView(client, {
					pluginSlug,
					name: `Disabled Tracked ${crypto.randomUUID()}`,
				});
				yield* createSavedView(client, { name: `Standalone ${crypto.randomUUID()}` });
				yield* updateSavedView(client, disabledTracked.slug, { pluginSlug, isDisabled: true });

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
			const pluginSlug = createPluginScope();
			const first = yield* createSavedView(client, {
				pluginSlug,
				name: `Tracker View A ${crypto.randomUUID()}`,
			});
			const second = yield* createSavedView(client, {
				pluginSlug,
				name: `Tracker View B ${crypto.randomUUID()}`,
			});
			const standalone = yield* createSavedView(client, {
				name: `Standalone View ${crypto.randomUUID()}`,
			});

			const reordered = yield* reorderSavedViews(client, {
				viewSlugs: [second.slug, first.slug],
				pluginSlug,
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
			const first = yield* createSavedView(client, { name: `Top View A ${crypto.randomUUID()}` });
			const second = yield* createSavedView(client, { name: `Top View B ${crypto.randomUUID()}` });
			const pluginSlug = createPluginScope();
			const tracked = yield* createSavedView(client, {
				pluginSlug,
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
			const pluginSlug = createPluginScope();
			const movedView = yield* createSavedView(client, {
				pluginSlug,
				name: `Movable View ${crypto.randomUUID()}`,
			});

			const updatedView = yield* updateSavedView(client, movedView.slug, {
				pluginSlug: undefined,
				name: `${movedView.name} Updated`,
			});
			const fetchedView = yield* getSavedView(client, movedView.slug);
			const topLevelViews = yield* listSavedViews(client, { includeDisabled: true });
			const pluginViews = yield* listSavedViews(client, { pluginSlug, includeDisabled: true });

			expect(updatedView.pluginSlug).toBeNull();
			expect(fetchedView.pluginSlug).toBeNull();
			expect(topLevelViews.map((v) => v.id)).toContain(movedView.id);
			expect(pluginViews.map((v) => v.id)).not.toContain(movedView.id);
		}),
	);

	it.live("rejects reorder requests containing saved views from another scope", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const pluginSlug = createPluginScope();
			const tracked = yield* createSavedView(client, {
				pluginSlug,
				name: `Scoped View ${crypto.randomUUID()}`,
			});
			const standalone = yield* createSavedView(client, {
				name: `Top Scope View ${crypto.randomUUID()}`,
			});

			const error = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.reorder({
						payload: { pluginSlug, viewSlugs: [tracked.slug, standalone.slug] },
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toBe("Saved view slugs contain unknown saved views");
		}),
	);
});
