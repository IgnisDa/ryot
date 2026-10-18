import { SavedViewId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import {
	buildUpdatedSavedViewBody,
	type Client,
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
	updateSavedView,
} from "~/fixtures/kernel";
import { findMediaEntitySchema } from "~/fixtures/plugins/media";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const missingViewReference = {
	kind: "custom" as const,
	savedViewId: SavedViewId.make("non-existent-view"),
};

const installPluginScope = Effect.fn(function* (client: Client) {
	const pluginSlug = createPluginScope();
	return yield* installPrivatePlugin({
		client,
		pluginSlug,
		config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "saved-view-scope" },
	});
});

const findAllMoviesView = (client: Client) =>
	Effect.gen(function* () {
		const { schema } = yield* findMediaEntitySchema(client, "movie");
		const pluginId = requirePresent(
			schema.reference.owner.kind === "plugin" ? schema.reference.owner.pluginId : undefined,
			"Media movie schema must have a plugin owner",
		);
		return yield* findBuiltinSavedView(client, { pluginId, kind: "plugin", slug: "all-movies" });
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
			expect(collectionsView?.renderer).toEqual({ kind: "kernel", name: "collection-browser" });
			expect(collectionsView?.settings).toMatchObject({
				sourceName: "savedView",
				subject: {
					entityAlias: "entity",
					schemas: [{ slug: "collection", owner: { kind: "kernel" } }],
				},
			});
			expect(collectionsView?.dataSources).toMatchObject({
				queries: {
					savedView: {
						where: {
							type: "and",
							predicates: [
								{
									right: { type: "literal", value: "collection" },
									left: { tableAlias: "entity", field: "entitySchemaSlug" },
								},
								{ type: "isNull", expr: { tableAlias: "entity", field: "entitySchemaPluginId" } },
							],
						},
					},
				},
			});
		}),
	);

	it.live("persists built-in visibility per user without copying definition content", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const builtinView = yield* findAllMoviesView(client);
			const updatedView = yield* client.call((c) =>
				c.savedViews.update({ payload: { isHidden: true, reference: builtinView.reference } }),
			);
			const fetchedView = yield* getSavedView(client, builtinView.reference);

			expect(updatedView.id).toBe(builtinView.id);
			expect(fetchedView.renderer).toEqual(builtinView.renderer);
			expect(fetchedView.createdAt).toBeNull();
			expect(fetchedView.updatedAt).toBeNull();
			expect(fetchedView.isHidden).toBe(true);
			expect((yield* getSavedView(other.client, builtinView.reference)).isHidden).toBe(false);
		}),
	);

	it.live("supports the full create-get-update-clone-delete lifecycle", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createSavedView(client, { name: "Lifecycle View" });
			const createdView = yield* findSavedViewById(client, created.id);
			const fetchedView = yield* getSavedView(client, createdView.reference);
			expect(fetchedView.id).toBe(createdView.id);
			expect(fetchedView.renderer).toEqual(createdView.renderer);
			expect(fetchedView.settings).toEqual(createdView.settings);
			expect(fetchedView.dataSources).toEqual(createdView.dataSources);
			expect(fetchedView.name).toBe("Lifecycle View");
			expect(fetchedView.isBuiltin).toBe(false);
			expect(fetchedView.isHidden).toBe(false);
			expect(
				Number.isNaN(
					Date.parse(requirePresent(fetchedView.createdAt, "Custom view has a creation date")),
				),
			).toBe(false);
			expect(
				Number.isNaN(
					Date.parse(requirePresent(fetchedView.updatedAt, "Custom view has an update date")),
				),
			).toBe(false);

			const cloned = yield* cloneSavedView(client, createdView.reference);
			const clonedView = yield* findSavedViewById(client, cloned.id);
			expect(clonedView.id).not.toBe(createdView.id);
			expect(clonedView.name).toBe("Lifecycle View (Copy)");
			expect(clonedView.isBuiltin).toBe(false);
			expect(clonedView.renderer).toEqual(createdView.renderer);
			expect(clonedView.settings).toEqual(createdView.settings);
			expect(clonedView.dataSources).toEqual(createdView.dataSources);
			const updatedClone = yield* updateSavedView(client, clonedView.reference, {
				name: "Lifecycle View Revised",
			});
			const fetchedUpdated = yield* getSavedView(client, clonedView.reference);
			expect(updatedClone.id).toBe(clonedView.id);
			expect(fetchedUpdated.name).toBe("Lifecycle View Revised");
			expect(fetchedUpdated.renderer).toEqual(createdView.renderer);
			expect(fetchedUpdated.id).toBe(clonedView.id);
			const deletedOriginal = yield* deleteSavedView(client, createdView.reference);
			const deletedClone = yield* deleteSavedView(client, clonedView.reference);
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
			const builtinView = yield* findAllMoviesView(client);
			const cloned = yield* cloneSavedView(client, builtinView.reference);
			const clonedView = yield* findSavedViewById(client, cloned.id);
			expect(clonedView.name).toBe(`${builtinView.name} (Copy)`);
			expect(clonedView.isBuiltin).toBe(false);
			expect(clonedView.renderer).toEqual(builtinView.renderer);
			expect(clonedView.settings).toEqual(builtinView.settings);
			expect(clonedView.dataSources).toEqual(builtinView.dataSources);
			const deletedClone = yield* deleteSavedView(client, clonedView.reference);
			const refreshedBuiltin = yield* getSavedView(client, builtinView.reference);
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
			const builtinView = yield* findAllMoviesView(client);
			const error = yield* Effect.flip(
				client.call((c) => c.savedViews.delete({ payload: { reference: builtinView.reference } })),
			);
			assertTaggedError(error, "SavedViewBadRequest");
			expect(error.reason).toEqual({
				code: "builtin-view-immutable",
				reference: builtinView.reference,
			});
		}),
	);

	it.live("rejects built-in updates that attempt to change fields other than isHidden", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinView = yield* findAllMoviesView(client);
			const { pluginId } = yield* findMediaEntitySchema(client, "book");
			const invalidUpdateError = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.update({
						payload: {
							...buildUpdatedSavedViewBody(pluginId, { isHidden: true, name: "Attempted Rename" }),
							reference: builtinView.reference,
						},
					}),
				),
			);

			assertTaggedError(invalidUpdateError, "SavedViewBadRequest");
			expect(invalidUpdateError.reason).toEqual({
				code: "builtin-view-immutable",
				reference: builtinView.reference,
			});

			const disableResult = yield* client.call((c) =>
				c.savedViews.update({ payload: { isHidden: true, reference: builtinView.reference } }),
			);
			const refreshedDisabled = yield* getSavedView(client, builtinView.reference);
			expect(disableResult.id).toBe(builtinView.id);
			expect(refreshedDisabled.isHidden).toBe(true);
			expect(refreshedDisabled.renderer).toEqual(builtinView.renderer);

			yield* client.call((c) =>
				c.savedViews.update({ payload: { isHidden: false, reference: builtinView.reference } }),
			);
			const fetchedReEnabled = yield* getSavedView(client, builtinView.reference);

			expect(fetchedReEnabled.isHidden).toBe(false);
			expect(fetchedReEnabled.settings).toEqual(builtinView.settings);
			expect(fetchedReEnabled.name).toBe(builtinView.name);
		}),
	);

	it.live("returns 404 for missing views across update, clone, and delete", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId } = yield* findMediaEntitySchema(client, "book");

			const updateError = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.update({
						payload: { ...buildUpdatedSavedViewBody(pluginId), reference: missingViewReference },
					}),
				),
			);
			const cloneError = yield* Effect.flip(
				client.call((c) => c.savedViews.clone({ payload: { reference: missingViewReference } })),
			);
			const deleteError = yield* Effect.flip(
				client.call((c) => c.savedViews.delete({ payload: { reference: missingViewReference } })),
			);

			for (const error of [updateError, cloneError, deleteError]) {
				assertTaggedError(error, "SavedViewNotFound");
				expect(error.reason).toEqual({
					code: "saved-view-not-found",
					reference: missingViewReference,
				});
			}
		}),
	);

	it.live("preserves immutable fields when updating user views", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createSavedView(client, { name: "Immutable Fields View" });
			const createdView = yield* findSavedViewById(client, created.id);

			yield* Effect.sleep(100);
			yield* updateSavedView(client, createdView.reference, {
				name: "Immutable Fields View Updated",
			});
			const refreshedView = yield* getSavedView(client, createdView.reference);

			expect(refreshedView.id).toBe(createdView.id);
			expect(refreshedView.renderer).toEqual(createdView.renderer);
			expect(refreshedView.isBuiltin).toBe(false);
			expect(refreshedView.createdAt).toBe(createdView.createdAt);
			expect(refreshedView.updatedAt).not.toBe(createdView.updatedAt);
		}),
	);

	it.live("supports toggling isHidden on user views", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createSavedView(client, { name: "Disable Toggle View" });
			const createdView = yield* findSavedViewById(client, created.id);

			expect(createdView.isHidden).toBe(false);

			const disabled = yield* updateSavedView(client, createdView.reference, { isHidden: true });
			const fetchedDisabled = yield* getSavedView(client, createdView.reference);

			expect(disabled.id).toBe(createdView.id);
			expect(fetchedDisabled.isHidden).toBe(true);

			const reEnabled = yield* updateSavedView(client, createdView.reference, { isHidden: false });
			const fetchedReEnabled = yield* getSavedView(client, createdView.reference);

			expect(reEnabled.id).toBe(createdView.id);
			expect(fetchedReEnabled.isHidden).toBe(false);
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

			yield* updateSavedView(client, createdView.reference, { isHidden: true });

			const listedViews = yield* listSavedViews(client);

			expect(listedViews.map((view) => view.id)).not.toContain(createdView.id);
			expect(listedViews.every((view) => !view.isHidden)).toBe(true);
		}),
	);

	it.live(
		"includes hidden saved views when includeHidden is true and respects plugin filters",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const workspace = yield* installPluginScope(client);
				const enabledCreated = yield* createSavedView(client, {
					name: `Enabled Tracked ${crypto.randomUUID()}`,
					workspaceInstallationId: workspace.installationId,
				});
				const enabledTracked = yield* findSavedViewById(client, enabledCreated.id);
				const disabledCreated = yield* createSavedView(client, {
					name: `Disabled Tracked ${crypto.randomUUID()}`,
					workspaceInstallationId: workspace.installationId,
				});
				const disabledTracked = yield* findSavedViewById(client, disabledCreated.id);
				yield* createSavedView(client, { name: `Standalone ${crypto.randomUUID()}` });
				yield* updateSavedView(client, disabledTracked.reference, {
					isHidden: true,
					workspaceInstallationId: workspace.installationId,
				});

				const listedViews = yield* listSavedViews(client, {
					includeHidden: true,
					installationId: workspace.installationId,
				});

				expect(new Set(listedViews.map((v) => v.id))).toEqual(
					new Set([enabledTracked.id, disabledTracked.id]),
				);
				expect(listedViews.map((v) => v.packageId)).toEqual([
					workspace.installation.packageId,
					workspace.installation.packageId,
				]);
				expect(listedViews.some((v) => v.isHidden)).toBe(true);
			}),
	);

	it.live("reorders saved views only within the requested plugin scope", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const workspace = yield* installPluginScope(client);
			const firstCreated = yield* createSavedView(client, {
				name: `Tracker View A ${crypto.randomUUID()}`,
				workspaceInstallationId: workspace.installationId,
			});
			const first = yield* findSavedViewById(client, firstCreated.id);
			const secondCreated = yield* createSavedView(client, {
				name: `Tracker View B ${crypto.randomUUID()}`,
				workspaceInstallationId: workspace.installationId,
			});
			const second = yield* findSavedViewById(client, secondCreated.id);
			const standalone = yield* createSavedView(client, {
				name: `Standalone View ${crypto.randomUUID()}`,
			});

			const reordered = yield* reorderSavedViews(client, {
				installationId: workspace.installationId,
				references: [second.reference, first.reference],
			});
			const scopedViews = yield* listSavedViews(client, {
				includeHidden: true,
				installationId: workspace.installationId,
			});
			const topLevelViews = yield* listSavedViews(client, { includeHidden: true });

			expect(reordered.references.slice(0, 2)).toEqual([second.reference, first.reference]);
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
			const workspace = yield* installPluginScope(client);
			const tracked = yield* createSavedView(client, {
				workspaceInstallationId: workspace.installationId,
				name: `Tracked Scope View ${crypto.randomUUID()}`,
			});

			yield* reorderSavedViews(client, { references: [second.reference, first.reference] });
			const topLevelViews = yield* listSavedViews(client, { includeHidden: true });
			const trackedViews = yield* listSavedViews(client, {
				includeHidden: true,
				installationId: workspace.installationId,
			});

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
			const workspace = yield* installPluginScope(client);
			const movedCreated = yield* createSavedView(client, {
				name: `Movable View ${crypto.randomUUID()}`,
				workspaceInstallationId: workspace.installationId,
			});
			const movedView = yield* findSavedViewById(client, movedCreated.id);

			const updatedView = yield* updateSavedView(client, movedView.reference, {
				workspaceInstallationId: null,
				name: `${movedView.name} Updated`,
			});
			const fetchedView = yield* getSavedView(client, movedView.reference);
			const topLevelViews = yield* listSavedViews(client, { includeHidden: true });
			const pluginViews = yield* listSavedViews(client, {
				includeHidden: true,
				installationId: workspace.installationId,
			});

			expect(updatedView.id).toBe(movedView.id);
			expect(fetchedView.packageId).toBeNull();
			expect(topLevelViews.map((v) => v.id)).toContain(movedView.id);
			expect(pluginViews.map((v) => v.id)).not.toContain(movedView.id);
		}),
	);

	it.live("reorders built-in and custom top-level views without altering their definitions", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtinView = requirePresent(
				(yield* listSavedViews(client, { includeHidden: true })).find(
					(view) => view.isBuiltin && view.packageId === null,
				),
				"Top-level built-in saved view not found",
			);
			const customCreated = yield* createSavedView(client, {
				name: `Mixed Scope View ${crypto.randomUUID()}`,
			});
			const customView = yield* findSavedViewById(client, customCreated.id);

			const reordered = yield* reorderSavedViews(client, {
				references: [customView.reference, builtinView.reference],
			});
			const topLevelViews = yield* listSavedViews(client, { includeHidden: true });
			const reorderedBuiltin = yield* getSavedView(client, builtinView.reference);

			expect(reordered.references.slice(0, 2)).toEqual([
				customView.reference,
				builtinView.reference,
			]);
			expect(
				topLevelViews
					.filter((view) => view.packageId === null)
					.map((view) => view.slug)
					.slice(0, 2),
			).toEqual([customView.slug, builtinView.slug]);
			expect(reorderedBuiltin).toMatchObject({
				isBuiltin: true,
				name: builtinView.name,
				icon: builtinView.icon,
				renderer: builtinView.renderer,
				settings: builtinView.settings,
				isHidden: builtinView.isHidden,
				dataSources: builtinView.dataSources,
			});
		}),
	);

	it.live("rejects reorder requests containing saved views from another scope", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const workspace = yield* installPluginScope(client);
			const trackedCreated = yield* createSavedView(client, {
				name: `Scoped View ${crypto.randomUUID()}`,
				workspaceInstallationId: workspace.installationId,
			});
			const tracked = yield* findSavedViewById(client, trackedCreated.id);
			const standaloneCreated = yield* createSavedView(client, {
				name: `Top Scope View ${crypto.randomUUID()}`,
			});
			const standalone = yield* findSavedViewById(client, standaloneCreated.id);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.reorder({
						payload: {
							installationId: workspace.installationId,
							references: [tracked.reference, standalone.reference],
						},
					}),
				),
			);

			assertTaggedError(error, "SavedViewBadRequest");
			expect(error.reason).toEqual({
				issue: "unknown-view",
				code: "invalid-reorder",
				references: [tracked.reference, standalone.reference],
			});
		}),
	);
});
