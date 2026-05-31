import { describe, expect, it } from "bun:test";

import {
	createEntityColumnExpression,
	createEntitySchemaExpression,
} from "@ryot/app-backend/query-language";

import {
	buildSavedViewBody,
	buildSavedViewQueryDocumentBody,
	buildUpdatedSavedViewBody,
	cloneSavedView,
	createAuthenticatedClient,
	createRelationshipSchema,
	createSavedView,
	createSavedViewWithQueryDocument,
	createQueryEngineTrackerAndSchema,
	deleteSavedView,
	entityField,
	findBuiltinSavedView,
	findBuiltinTrackerBySlug,
	getSavedView,
	listSavedViews,
	postBackendJson,
	reorderSavedViews,
	createTracker,
	systemRef,
	updateSavedView,
	updateSavedViewWithQueryDocument,
	type SavedViewQueryDocument,
} from "../fixtures";
import { assertTaggedError, requireObjectRecord, requireString } from "../test-support/assertions";

const rowsDocument: SavedViewQueryDocument = {
	source: { type: "entities", alias: "book", schemas: ["book"], where: null },
	output: {
		type: "rows",
		pagination: { page: 1, limit: 20 },
		fields: [{ key: "name", expr: systemRef("book", "name") }],
		orderBy: [{ order: "asc", expr: systemRef("book", "name") }],
	},
};

const aggregateDocument: SavedViewQueryDocument = {
	source: { type: "entities", alias: "book", schemas: ["book"], where: null },
	output: {
		groupBy: [],
		type: "aggregate",
		measures: [{ key: "total", aggregation: { function: "count" } }],
	},
};

const timeSeriesDocument: SavedViewQueryDocument = {
	source: { type: "entities", alias: "book", schemas: ["book"], where: null },
	output: {
		type: "timeSeries",
		measure: { aggregation: { function: "count" } },
		time: {
			bucket: "month",
			expr: systemRef("book", "createdAt"),
			range: { startAt: "2020-01-01T00:00:00.000Z", endAt: "2020-07-01T00:00:00.000Z" },
		},
	},
};

describe("Saved views query documents E2E", () => {
	it("stores media built-in saved views with canonical in-library filters", async () => {
		const { client } = await createAuthenticatedClient();
		const mediaTracker = await findBuiltinTrackerBySlug(client, "media");
		const views = await listSavedViews(client, { trackerId: mediaTracker.id });
		const allBooksView = views.find((view) => view.name === "All Books");

		expect(allBooksView?.queryDocument).toMatchObject({
			source: {
				schemas: ["book"],
				where: {
					type: "exists",
					source: {
						alias: "library",
						type: "entities",
						schemas: ["library"],
						via: { entityRef: "entity", schema: "in-library" },
					},
				},
			},
		});
	});

	it("creates and retrieves a saved view backed by a rows query document", async () => {
		const { client } = await createAuthenticatedClient();

		const createdView = await createSavedViewWithQueryDocument(client, rowsDocument, {
			name: `Rows View ${crypto.randomUUID()}`,
		});
		const fetchedView = await getSavedView(client, createdView.slug);

		expect(createdView.queryDocument).toEqual(rowsDocument);
		expect(fetchedView.queryDocument).toEqual(rowsDocument);
	});

	it("creates a saved view backed by an aggregate query document", async () => {
		const { client } = await createAuthenticatedClient();

		const createdView = await createSavedViewWithQueryDocument(client, aggregateDocument, {
			name: `Aggregate View ${crypto.randomUUID()}`,
		});

		expect(createdView.queryDocument).toEqual(aggregateDocument);
	});

	it("creates a saved view backed by a time series query document", async () => {
		const { client } = await createAuthenticatedClient();

		const createdView = await createSavedViewWithQueryDocument(client, timeSeriesDocument, {
			name: `Time Series View ${crypto.randomUUID()}`,
		});

		expect(createdView.queryDocument).toEqual(timeSeriesDocument);
	});

	it("updates a saved view's query document", async () => {
		const { client } = await createAuthenticatedClient();
		const createdView = await createSavedViewWithQueryDocument(client, rowsDocument, {
			name: `Updatable View ${crypto.randomUUID()}`,
		});

		const updatedView = await updateSavedViewWithQueryDocument(
			client,
			createdView.slug,
			aggregateDocument,
		);
		const fetchedView = await getSavedView(client, createdView.slug);

		expect(updatedView.queryDocument).toEqual(aggregateDocument);
		expect(fetchedView.queryDocument).toEqual(aggregateDocument);
	});

	it("preserves a full v2 document with a where clause and nested includes without stripping fields", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: courseSchemaId, slug: courseSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{
				schemaName: `SavedViewCourse ${crypto.randomUUID()}`,
			},
		);
		const { schemaId: moduleSchemaId, slug: moduleSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{
				schemaName: `SavedViewModule ${crypto.randomUUID()}`,
			},
		);
		const courseModuleSlug = `saved-view-course-module-${crypto.randomUUID()}`;
		await createRelationshipSchema(client, {
			slug: courseModuleSlug,
			name: "Saved View Course Module",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaId: courseSchemaId,
			targetEntitySchemaId: moduleSchemaId,
		});

		const hierarchicalDocument: SavedViewQueryDocument = {
			source: {
				alias: "course",
				type: "entities",
				schemas: [courseSlug],
				where: { type: "isNotNull", expr: systemRef("course", "name") },
			},
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				fields: [{ key: "name", expr: systemRef("course", "name") }],
				orderBy: [{ order: "asc", expr: systemRef("course", "name") }],
				include: [
					{
						limit: 20,
						key: "modules",
						fields: [{ key: "name", expr: systemRef("module", "name") }],
						orderBy: [{ order: "asc", expr: systemRef("module", "name") }],
						source: {
							alias: "module",
							type: "entities",
							schemas: [moduleSlug],
							where: null,
							via: {
								entityRef: "course",
								alias: "courseModule",
								direction: "outgoing",
								schema: courseModuleSlug,
							},
						},
					},
				],
			},
		};

		const createdView = await createSavedViewWithQueryDocument(client, hierarchicalDocument, {
			name: `Hierarchical View ${crypto.randomUUID()}`,
			displayConfiguration: {
				entityIdProperty: createEntityColumnExpression(courseSlug, "id"),
				table: { columns: [{ label: "Name", expression: [entityField(courseSlug, "name")] }] },
				grid: {
					imageProperty: [entityField(courseSlug, "image")],
					titleProperty: [entityField(courseSlug, "name")],
					eyebrowProperty: createEntitySchemaExpression("name"),
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				},
				list: {
					imageProperty: [entityField(courseSlug, "image")],
					titleProperty: [entityField(courseSlug, "name")],
					eyebrowProperty: createEntitySchemaExpression("name"),
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				},
			},
		});
		const fetchedView = await getSavedView(client, createdView.slug);

		expect(createdView.queryDocument).toEqual(hierarchicalDocument);
		expect(fetchedView.queryDocument).toEqual(hierarchicalDocument);
	});

	it("rejects a query document that fails semantic validation", async () => {
		const { client } = await createAuthenticatedClient();
		const invalidDocument: SavedViewQueryDocument = {
			...rowsDocument,
			source: {
				...rowsDocument.source,
				where: {
					operator: "eq",
					type: "comparison",
					right: { type: "literal", value: "x" },
					left: {
						type: "ref",
						sourceAlias: "unknownAlias",
						field: { type: "system", name: "name" },
					},
				},
			},
		};

		const error = await client.runError((c) =>
			c.savedViews.create({
				payload: buildSavedViewQueryDocumentBody(invalidDocument, {
					name: `Invalid View ${crypto.randomUUID()}`,
				}),
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Unknown source alias 'unknownAlias'");
	});

	it("rejects a query document with an unknown entity schema", async () => {
		const { client } = await createAuthenticatedClient();
		const invalidDocument: SavedViewQueryDocument = {
			...rowsDocument,
			source: { ...rowsDocument.source, schemas: ["does-not-exist"] },
		};

		const error = await client.runError((c) =>
			c.savedViews.create({
				payload: buildSavedViewQueryDocumentBody(invalidDocument, {
					name: `Unknown Entity Schema View ${crypto.randomUUID()}`,
				}),
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Entity schema 'does-not-exist' not found");
	});

	it("rejects a query document with an unknown event schema", async () => {
		const { client } = await createAuthenticatedClient();
		const invalidDocument: SavedViewQueryDocument = {
			...rowsDocument,
			source: {
				...rowsDocument.source,
				where: {
					type: "exists",
					source: {
						where: null,
						alias: "event",
						type: "events",
						entityRef: "book",
						schemas: ["does-not-exist"],
					},
				},
			},
		};

		const error = await client.runError((c) =>
			c.savedViews.create({
				payload: buildSavedViewQueryDocumentBody(invalidDocument, {
					name: `Unknown Event Schema View ${crypto.randomUUID()}`,
				}),
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Event schema 'does-not-exist' not found");
	});

	it("rejects a query document with an unknown relationship schema", async () => {
		const { client } = await createAuthenticatedClient();
		const invalidDocument: SavedViewQueryDocument = {
			...rowsDocument,
			output: {
				type: "rows",
				pagination: { page: 1, limit: 20 },
				fields: [{ key: "name", expr: systemRef("book", "name") }],
				orderBy: [{ order: "asc", expr: systemRef("book", "name") }],
				include: [
					{
						limit: 1,
						key: "related",
						fields: [{ key: "name", expr: systemRef("relatedBook", "name") }],
						orderBy: [{ order: "asc", expr: systemRef("relatedBook", "name") }],
						source: {
							where: null,
							alias: "relatedBook",
							type: "entities",
							schemas: ["book"],
							via: {
								entityRef: "book",
								alias: "related",
								direction: "outgoing",
								schema: "does-not-exist",
							},
						},
					},
				],
			},
		};

		const error = await client.runError((c) =>
			c.savedViews.create({
				payload: buildSavedViewQueryDocumentBody(invalidDocument, {
					name: `Unknown Relationship Schema View ${crypto.randomUUID()}`,
				}),
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Relationship schema 'does-not-exist' not found");
	});
});

const builtinViewError = "Cannot modify built-in saved views";
const missingViewSlug = "non-existent-view-slug";

describe("Saved views lifecycle E2E", () => {
	it("lists built-in and user-created views together", async () => {
		const { client } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, {
			name: `List Coverage ${crypto.randomUUID()}`,
		});

		const listedViews = await listSavedViews(client);
		const listedViewIds = listedViews.map((view) => view.id);

		expect(listedViews.some((view) => view.isBuiltin)).toBe(true);
		expect(listedViewIds).toContain(createdView.id);
	});

	it("seeds the Collections built-in view against the collection schema", async () => {
		const { client } = await createAuthenticatedClient();
		const views = await listSavedViews(client);
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
	});

	it("supports the full create-get-update-clone-delete lifecycle", async () => {
		const { client } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, { name: "Lifecycle View" });
		const fetchedView = await getSavedView(client, createdView.slug);

		expect(fetchedView.id).toBe(createdView.id);
		expect(fetchedView.name).toBe("Lifecycle View");
		expect(fetchedView.isBuiltin).toBe(false);
		expect(fetchedView.isDisabled).toBe(false);
		expect(Number.isNaN(Date.parse(fetchedView.createdAt))).toBe(false);
		expect(Number.isNaN(Date.parse(fetchedView.updatedAt))).toBe(false);

		const clonedView = await cloneSavedView(client, createdView.slug);
		expect(clonedView.id).not.toBe(createdView.id);
		expect(clonedView.name).toBe("Lifecycle View (Copy)");
		expect(clonedView.isBuiltin).toBe(false);

		const updatedClone = await updateSavedView(client, clonedView.slug, {
			name: "Lifecycle View Revised",
		});
		const fetchedUpdated = await getSavedView(client, clonedView.slug);

		expect(updatedClone.name).toBe("Lifecycle View Revised");
		expect(fetchedUpdated.id).toBe(clonedView.id);

		const deletedOriginal = await deleteSavedView(client, createdView.slug);
		const deletedClone = await deleteSavedView(client, clonedView.slug);
		const remaining = await listSavedViews(client);
		const remainingIds = remaining.map((v) => v.id);

		expect(deletedOriginal.id).toBe(createdView.id);
		expect(deletedClone.id).toBe(clonedView.id);
		expect(remainingIds).not.toContain(createdView.id);
		expect(remainingIds).not.toContain(clonedView.id);
	});

	it("clones a built-in view into a deletable user view", async () => {
		const { client } = await createAuthenticatedClient();
		const builtinView = await findBuiltinSavedView(client);
		const clonedView = await cloneSavedView(client, builtinView.slug);

		expect(clonedView.name).toBe(`${builtinView.name} (Copy)`);
		expect(clonedView.isBuiltin).toBe(false);

		const deletedClone = await deleteSavedView(client, clonedView.slug);
		const refreshedBuiltin = await getSavedView(client, builtinView.slug);
		const remaining = await listSavedViews(client);
		const remainingIds = remaining.map((v) => v.id);

		expect(deletedClone.id).toBe(clonedView.id);
		expect(refreshedBuiltin.id).toBe(builtinView.id);
		expect(remainingIds).not.toContain(clonedView.id);
	});

	it("rejects deletes for built-in views", async () => {
		const { client } = await createAuthenticatedClient();
		const builtinView = await findBuiltinSavedView(client);

		const error = await client.runError((c) =>
			c.savedViews.delete({ path: { viewSlug: builtinView.slug } }),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toBe(builtinViewError);
	});

	it("rejects built-in updates that attempt to change fields other than isDisabled", async () => {
		const { client } = await createAuthenticatedClient();
		const builtinView = await findBuiltinSavedView(client);

		const invalidUpdateError = await client.runError((c) =>
			c.savedViews.update({
				path: { viewSlug: builtinView.slug },
				payload: buildUpdatedSavedViewBody({ isDisabled: true, name: "Attempted Rename" }),
			}),
		);

		assertTaggedError(invalidUpdateError, "BadRequest");
		expect(invalidUpdateError.message).toBe(builtinViewError);

		const disableResult = await client.run((c) =>
			c.savedViews.update({
				path: { viewSlug: builtinView.slug },
				payload: {
					isDisabled: true,
					icon: builtinView.icon,
					name: builtinView.name,
					accentColor: builtinView.accentColor,
					queryDocument: builtinView.queryDocument,
					displayConfiguration: builtinView.displayConfiguration,
					...(builtinView.trackerId ? { trackerId: builtinView.trackerId } : {}),
				},
			}),
		);
		expect(disableResult.isDisabled).toBe(true);

		await client.run((c) =>
			c.savedViews.update({
				path: { viewSlug: builtinView.slug },
				payload: {
					isDisabled: false,
					icon: builtinView.icon,
					name: builtinView.name,
					accentColor: builtinView.accentColor,
					queryDocument: builtinView.queryDocument,
					displayConfiguration: builtinView.displayConfiguration,
					...(builtinView.trackerId ? { trackerId: builtinView.trackerId } : {}),
				},
			}),
		);
		const fetchedReEnabled = await getSavedView(client, builtinView.slug);

		expect(fetchedReEnabled.isDisabled).toBe(false);
		expect(fetchedReEnabled.name).toBe(builtinView.name);
	});

	it("returns 404 for missing views across read, update, clone, and delete", async () => {
		const { client } = await createAuthenticatedClient();

		const readError = await client.runError((c) =>
			c.savedViews.get({ path: { viewSlug: missingViewSlug } }),
		);
		const updateError = await client.runError((c) =>
			c.savedViews.update({
				path: { viewSlug: missingViewSlug },
				payload: buildUpdatedSavedViewBody(),
			}),
		);
		const cloneError = await client.runError((c) =>
			c.savedViews.clone({ path: { viewSlug: missingViewSlug } }),
		);
		const deleteError = await client.runError((c) =>
			c.savedViews.delete({ path: { viewSlug: missingViewSlug } }),
		);

		for (const error of [readError, updateError, cloneError, deleteError]) {
			assertTaggedError(error, "NotFound");
			expect(error.message).toBe("Saved view not found");
		}
	});

	it("preserves immutable fields when updating user views", async () => {
		const { client } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, { name: "Immutable Fields View" });

		await new Promise((resolve) => setTimeout(resolve, 100));
		await updateSavedView(client, createdView.slug, { name: "Immutable Fields View Updated" });
		const refreshedView = await getSavedView(client, createdView.slug);

		expect(refreshedView.id).toBe(createdView.id);
		expect(refreshedView.isBuiltin).toBe(false);
		expect(refreshedView.createdAt).toBe(createdView.createdAt);
		expect(refreshedView.updatedAt).not.toBe(createdView.updatedAt);
	});

	it("supports toggling isDisabled on user views", async () => {
		const { client } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, { name: "Disable Toggle View" });

		expect(createdView.isDisabled).toBe(false);

		const disabledView = await updateSavedView(client, createdView.slug, { isDisabled: true });
		const fetchedDisabled = await getSavedView(client, createdView.slug);

		expect(disabledView.isDisabled).toBe(true);
		expect(fetchedDisabled.isDisabled).toBe(true);

		const reEnabledView = await updateSavedView(client, createdView.slug, { isDisabled: false });
		const fetchedReEnabled = await getSavedView(client, createdView.slug);

		expect(reEnabledView.isDisabled).toBe(false);
		expect(fetchedReEnabled.isDisabled).toBe(false);
	});

	it("lists only enabled saved views by default", async () => {
		const { client } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, {
			name: `Filtered View ${crypto.randomUUID()}`,
		});

		await updateSavedView(client, createdView.slug, { isDisabled: true });

		const listedViews = await listSavedViews(client);

		expect(listedViews.map((view) => view.id)).not.toContain(createdView.id);
		expect(listedViews.every((view) => !view.isDisabled)).toBe(true);
	});

	it("includes disabled saved views when includeDisabled is true and respects tracker filters", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: `Tracked Views ${crypto.randomUUID()}`,
		});
		const enabledTracked = await createSavedView(client, {
			trackerId,
			name: `Enabled Tracked ${crypto.randomUUID()}`,
		});
		const disabledTracked = await createSavedView(client, {
			trackerId,
			name: `Disabled Tracked ${crypto.randomUUID()}`,
		});
		await createSavedView(client, { name: `Standalone ${crypto.randomUUID()}` });
		await updateSavedView(client, disabledTracked.slug, { trackerId, isDisabled: true });

		const listedViews = await listSavedViews(client, { trackerId, includeDisabled: true });

		expect(new Set(listedViews.map((v) => v.id))).toEqual(
			new Set([disabledTracked.id, enabledTracked.id]),
		);
		expect(listedViews.map((v) => v.trackerId)).toEqual([trackerId, trackerId]);
		expect(listedViews.some((v) => v.isDisabled)).toBe(true);
	});

	it("reorders saved views only within the requested tracker scope", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: `Tracker Scoped Views ${crypto.randomUUID()}`,
		});
		const first = await createSavedView(client, {
			trackerId,
			name: `Tracker View A ${crypto.randomUUID()}`,
		});
		const second = await createSavedView(client, {
			trackerId,
			name: `Tracker View B ${crypto.randomUUID()}`,
		});
		const standalone = await createSavedView(client, {
			name: `Standalone View ${crypto.randomUUID()}`,
		});

		const reordered = await reorderSavedViews(client, {
			viewSlugs: [second.slug, first.slug],
			trackerId,
		});
		const scopedViews = await listSavedViews(client, { trackerId, includeDisabled: true });
		const topLevelViews = await listSavedViews(client, { includeDisabled: true });

		expect(reordered.viewSlugs.slice(0, 2)).toEqual([second.slug, first.slug]);
		expect(scopedViews.map((v) => v.slug).slice(0, 2)).toEqual([second.slug, first.slug]);
		expect(topLevelViews.some((v) => v.id === standalone.id)).toBe(true);
	});

	it("reorders only top-level saved views when trackerId is omitted", async () => {
		const { client } = await createAuthenticatedClient();
		const first = await createSavedView(client, { name: `Top View A ${crypto.randomUUID()}` });
		const second = await createSavedView(client, { name: `Top View B ${crypto.randomUUID()}` });
		const { trackerId } = await createTracker(client, {
			name: `Unrelated Tracker ${crypto.randomUUID()}`,
		});
		const tracked = await createSavedView(client, {
			trackerId,
			name: `Tracked Scope View ${crypto.randomUUID()}`,
		});

		await reorderSavedViews(client, { viewSlugs: [second.slug, first.slug] });
		const topLevelViews = await listSavedViews(client, { includeDisabled: true });
		const trackedViews = await listSavedViews(client, { trackerId, includeDisabled: true });

		const orderedSlugs = topLevelViews
			.filter((v) => v.slug === first.slug || v.slug === second.slug)
			.map((v) => v.slug);

		expect(orderedSlugs).toEqual([second.slug, first.slug]);
		expect(trackedViews.some((v) => v.id === tracked.id)).toBe(true);
	});

	it("moves a saved view to top-level when trackerId is omitted on update", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: `Move View Tracker ${crypto.randomUUID()}`,
		});
		const movedView = await createSavedView(client, {
			trackerId,
			name: `Movable View ${crypto.randomUUID()}`,
		});

		const updatedView = await updateSavedView(client, movedView.slug, {
			trackerId: undefined,
			name: `${movedView.name} Updated`,
		});
		const fetchedView = await getSavedView(client, movedView.slug);
		const topLevelViews = await listSavedViews(client, { includeDisabled: true });
		const trackerViews = await listSavedViews(client, { trackerId, includeDisabled: true });

		expect(updatedView.trackerId).toBeNull();
		expect(fetchedView.trackerId).toBeNull();
		expect(topLevelViews.map((v) => v.id)).toContain(movedView.id);
		expect(trackerViews.map((v) => v.id)).not.toContain(movedView.id);
	});

	it("rejects reorder requests containing saved views from another scope", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: `Strict Scope Tracker ${crypto.randomUUID()}`,
		});
		const tracked = await createSavedView(client, {
			trackerId,
			name: `Scoped View ${crypto.randomUUID()}`,
		});
		const standalone = await createSavedView(client, {
			name: `Top Scope View ${crypto.randomUUID()}`,
		});

		const error = await client.runError((c) =>
			c.savedViews.reorder({
				payload: { trackerId, viewSlugs: [tracked.slug, standalone.slug] },
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toBe("Saved view slugs contain unknown saved views");
	});

	it("rejects a view with a null title property in the display config", async () => {
		const { cookies } = await createAuthenticatedClient();
		const createBody = buildSavedViewBody();
		const invalidTitleProperty = JSON.parse("null");

		const response = await postBackendJson(
			"/saved-views",
			{
				...createBody,
				displayConfiguration: {
					...createBody.displayConfiguration,
					grid: { ...createBody.displayConfiguration.grid, titleProperty: invalidTitleProperty },
					list: { ...createBody.displayConfiguration.list, titleProperty: invalidTitleProperty },
				},
			},
			cookies,
		);
		const error = requireObjectRecord(await response.json(), "Expected BadRequest response");
		const message = requireString(error.message, "Expected BadRequest message");

		expect(response.status).toBe(400);
		expect(requireString(error._tag, "Expected error tag")).toBe("BadRequest");
		expect(message).toContain("displayConfiguration");
		expect(message).toContain("titleProperty");
	});

	it("rejects a view with no table columns in the display config", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
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
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("At least one table column is required");
	});

	it("rejects a view with an invalid built-in column in the display config", async () => {
		const { client } = await createAuthenticatedClient();
		const createBody = buildSavedViewBody();

		const error = await client.runError((c) =>
			c.savedViews.create({
				payload: {
					...createBody,
					displayConfiguration: {
						...createBody.displayConfiguration,
						entityIdProperty: createEntityColumnExpression("book", "nam"),
					},
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Unsupported entity column 'entity.book.nam'");
	});

	it("persists entityIdProperty and eyebrowProperty through create and refetch", async () => {
		const { client } = await createAuthenticatedClient();
		const entityIdProperty = createEntityColumnExpression("book", "id");
		const eyebrowProperty = createEntitySchemaExpression("name");

		const createdView = await createSavedView(client, {
			name: `Display Contract ${crypto.randomUUID()}`,
			displayConfiguration: {
				entityIdProperty,
				grid: { eyebrowProperty },
				list: { eyebrowProperty },
				table: { columns: [{ label: "Name", expression: [entityField("book", "name")] }] },
			},
		});
		const fetchedView = await getSavedView(client, createdView.slug);

		expect(createdView.displayConfiguration.entityIdProperty).toEqual(entityIdProperty);
		expect(fetchedView.displayConfiguration.entityIdProperty).toEqual(entityIdProperty);
		expect(fetchedView.displayConfiguration.grid.eyebrowProperty).toEqual(eyebrowProperty);
		expect(fetchedView.displayConfiguration.list.eyebrowProperty).toEqual(eyebrowProperty);
	});

	it("rejects invalid entityIdProperty on create and update", async () => {
		const { client } = await createAuthenticatedClient();
		const invalidEntityIdProperty = JSON.parse('{"type":"literal","value":1}');

		const createBody = buildSavedViewBody();
		const createError = await client.runError((c) =>
			c.savedViews.create({
				payload: {
					...createBody,
					displayConfiguration: {
						...createBody.displayConfiguration,
						entityIdProperty: invalidEntityIdProperty,
					},
				},
			}),
		);

		const createdView = await createSavedView(client);
		const updateBody = buildUpdatedSavedViewBody();
		const updateError = await client.runError((c) =>
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
		);

		assertTaggedError(createError, "BadRequest");
		assertTaggedError(updateError, "BadRequest");
		expect(createError.message).toContain("entityIdProperty");
		expect(updateError.message).toContain("entityIdProperty");
		expect(createError.message).toContain("string expression");
		expect(updateError.message).toContain("string expression");
	});
});
