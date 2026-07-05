import {
	createEntityColumnExpression,
	createEntitySchemaExpression,
} from "@ryot/contract/display-configuration";
import { Effect } from "effect";

import {
	buildSavedViewBody,
	buildUpdatedSavedViewBody,
	cloneSavedView,
	createAuthenticatedClient,
	createSavedView,
	createPluginScope,
	deleteSavedView,
	entityField,
	findBuiltinSavedView,
	getSavedView,
	listSavedViews,
	postBackendJson,
	reorderSavedViews,
	updateSavedView,
} from "~/fixtures";
import { assertTaggedError, requireObjectRecord, requireString } from "~/support/assertions";
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

	it.live("seeds the Collections built-in view against the collection schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const views = yield* listSavedViews(client);
			const collectionsView = views.find((view) => view.name === "Collections");
			expect(collectionsView).toBeDefined();
			expect(collectionsView).toMatchObject({
				icon: "folders",
				isBuiltin: true,
				name: "Collections",
				accentColor: "#F59E0B",
			});
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			expect(collectionsView!.queryDocument.source).toMatchObject({ schemas: ["collection"] });
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
				client.call((c) => c.savedViews.delete({ path: { viewSlug: builtinView.slug } })),
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
						path: { viewSlug: builtinView.slug },
						payload: buildUpdatedSavedViewBody({ isDisabled: true, name: "Attempted Rename" }),
					}),
				),
			);

			assertTaggedError(invalidUpdateError, "BadRequest");
			expect(invalidUpdateError.message).toBe(builtinViewError);

			const disableResult = yield* client.call((c) =>
				c.savedViews.update({
					path: { viewSlug: builtinView.slug },
					payload: {
						isDisabled: true,
						icon: builtinView.icon,
						name: builtinView.name,
						accentColor: builtinView.accentColor,
						queryDocument: builtinView.queryDocument,
						displayConfiguration: builtinView.displayConfiguration,
						...(builtinView.pluginSlug ? { pluginSlug: builtinView.pluginSlug } : {}),
					},
				}),
			);
			expect(disableResult.isDisabled).toBe(true);

			yield* client.call((c) =>
				c.savedViews.update({
					path: { viewSlug: builtinView.slug },
					payload: {
						isDisabled: false,
						icon: builtinView.icon,
						name: builtinView.name,
						accentColor: builtinView.accentColor,
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

	it.live("returns 404 for missing views across read, update, clone, and delete", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const readError = yield* Effect.flip(
				client.call((c) => c.savedViews.get({ path: { viewSlug: missingViewSlug } })),
			);
			const updateError = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.update({
						path: { viewSlug: missingViewSlug },
						payload: buildUpdatedSavedViewBody(),
					}),
				),
			);
			const cloneError = yield* Effect.flip(
				client.call((c) => c.savedViews.clone({ path: { viewSlug: missingViewSlug } })),
			);
			const deleteError = yield* Effect.flip(
				client.call((c) => c.savedViews.delete({ path: { viewSlug: missingViewSlug } })),
			);

			for (const error of [readError, updateError, cloneError, deleteError]) {
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

	it.live("rejects a view with a null title property in the display config", () =>
		Effect.gen(function* () {
			const { cookies } = yield* createAuthenticatedClient();
			const createBody = buildSavedViewBody();
			const invalidTitleProperty = JSON.parse("null");

			const response = yield* Effect.promise(() =>
				postBackendJson(
					"/saved-views",
					{
						...createBody,
						displayConfiguration: {
							...createBody.displayConfiguration,
							grid: {
								...createBody.displayConfiguration.grid,
								titleProperty: invalidTitleProperty,
							},
							list: {
								...createBody.displayConfiguration.list,
								titleProperty: invalidTitleProperty,
							},
						},
					},
					cookies,
				),
			);
			const error = requireObjectRecord(
				yield* Effect.promise(() => response.json()),
				"Expected BadRequest response",
			);
			const message = requireString(error.message, "Expected BadRequest message");

			expect(response.status).toBe(400);
			expect(requireString(error._tag, "Expected error tag")).toBe("BadRequest");
			expect(message).toContain("displayConfiguration");
			expect(message).toContain("titleProperty");
		}),
	);

	it.live("rejects a view with no table columns in the display config", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.create({
						payload: buildSavedViewBody({
							displayConfiguration: {
								table: { columns: [] },
								grid: {
									eyebrowProperty: null,
									calloutProperty: null,
									imageProperty: null,
									primarySubtitleProperty: null,
									secondarySubtitleProperty: null,
									titleProperty: [entityField("book", "name")],
								},
								list: {
									eyebrowProperty: null,
									calloutProperty: null,
									imageProperty: null,
									primarySubtitleProperty: null,
									secondarySubtitleProperty: null,
									titleProperty: [entityField("book", "name")],
								},
							},
						}),
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("At least one table column is required");
		}),
	);

	it.live("rejects a view with an invalid built-in column in the display config", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createBody = buildSavedViewBody();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.create({
						payload: {
							...createBody,
							displayConfiguration: {
								...createBody.displayConfiguration,
								entityIdProperty: createEntityColumnExpression("book", "nam"),
							},
						},
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("Unsupported entity column 'entity.book.nam'");
		}),
	);

	it.live("persists entityIdProperty and eyebrowProperty through create and refetch", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const entityIdProperty = createEntityColumnExpression("book", "id");
			const eyebrowProperty = createEntitySchemaExpression("name");

			const createdView = yield* createSavedView(client, {
				name: `Display Contract ${crypto.randomUUID()}`,
				displayConfiguration: {
					entityIdProperty,
					grid: { eyebrowProperty },
					list: { eyebrowProperty },
					table: { columns: [{ label: "Name", expression: [entityField("book", "name")] }] },
				},
			});
			const fetchedView = yield* getSavedView(client, createdView.slug);

			expect(createdView.displayConfiguration.entityIdProperty).toEqual(entityIdProperty);
			expect(fetchedView.displayConfiguration.entityIdProperty).toEqual(entityIdProperty);
			expect(fetchedView.displayConfiguration.grid.eyebrowProperty).toEqual(eyebrowProperty);
			expect(fetchedView.displayConfiguration.list.eyebrowProperty).toEqual(eyebrowProperty);
		}),
	);

	it.live("rejects invalid entityIdProperty on create and update", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const invalidEntityIdProperty = JSON.parse('{"type":"literal","value":1}');

			const createBody = buildSavedViewBody();
			const createError = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.create({
						payload: {
							...createBody,
							displayConfiguration: {
								...createBody.displayConfiguration,
								entityIdProperty: invalidEntityIdProperty,
							},
						},
					}),
				),
			);

			const createdView = yield* createSavedView(client);
			const updateBody = buildUpdatedSavedViewBody();
			const updateError = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.update({
						path: { viewSlug: createdView.slug },
						payload: {
							...updateBody,
							displayConfiguration: {
								...updateBody.displayConfiguration,
								entityIdProperty: invalidEntityIdProperty,
							},
						},
					}),
				),
			);

			assertTaggedError(createError, "BadRequest");
			assertTaggedError(updateError, "BadRequest");
			expect(createError.message).toContain("entityIdProperty");
			expect(updateError.message).toContain("entityIdProperty");
			expect(createError.message).toContain("string expression");
			expect(updateError.message).toContain("string expression");
		}),
	);
});
