import { describe, expect, it } from "bun:test";

import {
	createEntityColumnExpression,
	createEntitySchemaExpression,
} from "@ryot/app-backend/query-language";

import {
	cloneSavedView,
	createAuthenticatedClient,
	createQueryEngineTrackerAndSchema,
	createSavedView,
	createSavedViewWithQueryDocument,
	deleteSavedView,
	entityField,
	findBuiltinSavedView,
	getSavedView,
	listSavedViews,
	reorderSavedViews,
	updateSavedViewWithQueryDocument,
	type SavedViewQueryDocument,
	listTrackers,
	systemRef,
} from "../fixtures";

const rowsDocument: SavedViewQueryDocument = {
	version: 2,
	source: { type: "entities", alias: "book", schemas: ["book"], where: null },
	output: {
		type: "rows",
		pagination: { page: 1, limit: 20 },
		fields: [{ key: "name", expr: systemRef("book", "name") }],
		orderBy: [{ order: "asc", expr: systemRef("book", "name") }],
	},
};

const aggregateDocument: SavedViewQueryDocument = {
	version: 2,
	source: { type: "entities", alias: "book", schemas: ["book"], where: null },
	output: {
		type: "aggregate",
		groupBy: [],
		measures: [{ key: "total", aggregation: { function: "count" } }],
	},
};

const buildSchemaRowsDocument = (slug: string): SavedViewQueryDocument => ({
	version: 2,
	source: { type: "entities", alias: "item", schemas: [slug], where: null },
	output: {
		type: "rows",
		pagination: { page: 1, limit: 20 },
		fields: [{ key: "name", expr: systemRef("item", "name") }],
		orderBy: [{ order: "asc", expr: systemRef("item", "name") }],
	},
});

const buildSchemaDisplayConfiguration = (slug: string) => ({
	entityIdProperty: createEntityColumnExpression(slug, "id"),
	table: { columns: [{ label: "Name", expression: [entityField(slug, "name")] }] },
	grid: {
		imageProperty: [entityField(slug, "image")],
		titleProperty: [entityField(slug, "name")],
		eyebrowProperty: createEntitySchemaExpression("name"),
		calloutProperty: null,
		primarySubtitleProperty: null,
		secondarySubtitleProperty: null,
	},
	list: {
		imageProperty: [entityField(slug, "image")],
		titleProperty: [entityField(slug, "name")],
		eyebrowProperty: createEntitySchemaExpression("name"),
		calloutProperty: null,
		primarySubtitleProperty: null,
		secondarySubtitleProperty: null,
	},
});

const buildBuiltinUpdatePayload = (view: Awaited<ReturnType<typeof getSavedView>>) => ({
	icon: view.icon,
	name: view.name,
	isDisabled: view.isDisabled,
	accentColor: view.accentColor,
	queryDocument: view.queryDocument,
	displayConfiguration: view.displayConfiguration,
	...(view.trackerId ? { trackerId: view.trackerId } : {}),
});

describe("saved views management", () => {
	it("lists built-in and user-created views together", async () => {
		const { client } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, {
			name: `Managed View ${crypto.randomUUID()}`,
		});

		const views = await listSavedViews(client);
		expect(views.some((view) => view.isBuiltin)).toBe(true);
		expect(views.map((view) => view.id)).toContain(createdView.id);
	});

	it("seeds the Collections built-in view against the collection schema", async () => {
		const { client } = await createAuthenticatedClient();
		const views = await listSavedViews(client);
		const collectionsView = views.find((view) => view.name === "Collections");

		expect(collectionsView).toMatchObject({
			isBuiltin: true,
			name: "Collections",
			queryDocument: {
				source: { type: "entities", alias: "entity", schemas: ["collection"] },
			},
		});
	});

	it("supports the full create-get-update-clone-delete lifecycle", async () => {
		const { client } = await createAuthenticatedClient();
		const createdView = await createSavedViewWithQueryDocument(client, rowsDocument, {
			name: `Lifecycle View ${crypto.randomUUID()}`,
		});
		const fetchedView = await getSavedView(client, createdView.slug);

		expect(fetchedView.id).toBe(createdView.id);
		expect(fetchedView.isBuiltin).toBe(false);

		const updatedView = await updateSavedViewWithQueryDocument(
			client,
			createdView.slug,
			aggregateDocument,
			{ name: `${createdView.name} Updated` },
		);
		expect(updatedView.queryDocument).toEqual(aggregateDocument);

		const clonedView = await cloneSavedView(client, createdView.slug);
		expect(clonedView.id).not.toBe(createdView.id);
		expect(clonedView.name).toBe(`${createdView.name} Updated (Copy)`);

		const deletedOriginal = await deleteSavedView(client, createdView.slug);
		const deletedClone = await deleteSavedView(client, clonedView.slug);
		const remainingViews = await listSavedViews(client);
		const remainingIds = remainingViews.map((view) => view.id);

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
		expect(deletedClone.id).toBe(clonedView.id);
		expect(refreshedBuiltin.id).toBe(builtinView.id);
	});

	it("rejects deletes for built-in views", async () => {
		const { client } = await createAuthenticatedClient();
		const builtinView = await findBuiltinSavedView(client);

		const error = await client.runError((c) =>
			c.savedViews.delete({ path: { viewSlug: builtinView.slug } }),
		);

		expect(error).toMatchObject({ _tag: "BadRequest" });
		expect(error.message).toBe("Cannot modify built-in saved views");
	});

	it("rejects built-in updates that change fields other than isDisabled", async () => {
		const { client } = await createAuthenticatedClient();
		const builtinView = await findBuiltinSavedView(client);

		const invalidUpdateError = await client.runError((c) =>
			c.savedViews.update({
				path: { viewSlug: builtinView.slug },
				payload: { ...buildBuiltinUpdatePayload(builtinView), name: `${builtinView.name} Renamed` },
			}),
		);
		expect(invalidUpdateError).toMatchObject({ _tag: "BadRequest" });

		const disabledView = await client.run((c) =>
			c.savedViews.update({
				path: { viewSlug: builtinView.slug },
				payload: { ...buildBuiltinUpdatePayload(builtinView), isDisabled: true },
			}),
		);
		expect(disabledView.isDisabled).toBe(true);

		const reenabledView = await client.run((c) =>
			c.savedViews.update({
				path: { viewSlug: builtinView.slug },
				payload: { ...buildBuiltinUpdatePayload(disabledView), isDisabled: false },
			}),
		);
		expect(reenabledView.isDisabled).toBe(false);
	});

	it("toggles isDisabled on user views and respects list filtering", async () => {
		const { client } = await createAuthenticatedClient();
		const createdView = await createSavedViewWithQueryDocument(client, rowsDocument, {
			name: `Disabled View ${crypto.randomUUID()}`,
		});

		await updateSavedViewWithQueryDocument(client, createdView.slug, rowsDocument, {
			name: createdView.name,
			isDisabled: true,
		});

		const enabledViews = await listSavedViews(client);
		const allViews = await listSavedViews(client, { includeDisabled: true });

		expect(enabledViews.map((view) => view.id)).not.toContain(createdView.id);
		expect(allViews.map((view) => view.id)).toContain(createdView.id);
	});

	it("filters views by tracker and reorders them within the requested scope", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: `SavedViewTracked ${crypto.randomUUID()}`,
		});
		const viewDocument = buildSchemaRowsDocument(slug);
		const displayConfiguration = buildSchemaDisplayConfiguration(slug);

		const trackerViewA = await createSavedViewWithQueryDocument(client, viewDocument, {
			trackerId,
			name: `Tracker View A ${crypto.randomUUID()}`,
			displayConfiguration,
		});
		const trackerViewB = await createSavedViewWithQueryDocument(client, viewDocument, {
			trackerId,
			name: `Tracker View B ${crypto.randomUUID()}`,
			displayConfiguration,
		});
		const trackerViewC = await createSavedViewWithQueryDocument(client, viewDocument, {
			trackerId,
			name: `Tracker View C ${crypto.randomUUID()}`,
			displayConfiguration,
		});
		await createSavedView(client, { name: `Top Level View ${crypto.randomUUID()}` });

		const trackerViews = await listSavedViews(client, { trackerId });
		expect(trackerViews.map((view) => view.id)).toContain(trackerViewA.id);
		expect(trackerViews.map((view) => view.id)).toContain(trackerViewB.id);
		expect(trackerViews.map((view) => view.id)).toContain(trackerViewC.id);

		const reordered = await reorderSavedViews(client, {
			trackerId,
			viewSlugs: [trackerViewC.slug, trackerViewA.slug],
		});
		expect(reordered.viewSlugs[0]).toBe(trackerViewC.slug);
		expect(reordered.viewSlugs[1]).toBe(trackerViewA.slug);
		expect(reordered.viewSlugs).toContain(trackerViewB.slug);

		const reorderedViews = await listSavedViews(client, { trackerId });
		expect(reorderedViews[0]?.slug).toBe(trackerViewC.slug);
		expect(reorderedViews[1]?.slug).toBe(trackerViewA.slug);
		expect(reorderedViews.map((view) => view.slug)).toContain(trackerViewB.slug);

		const trackers = await listTrackers(client, { includeDisabled: true });
		const trackerIds = trackers.map((tracker) => tracker.id);
		expect(trackerIds).toContain(trackerId);
	});
});
