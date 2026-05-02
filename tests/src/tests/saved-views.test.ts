import { describe, expect, it } from "bun:test";
import {
	createComputedFieldExpression,
	createEntityColumnExpression,
	createEntityPropertyExpression,
	createEventAggregateExpression,
} from "@ryot/ts-utils";
import {
	buildGridRequest,
	buildSavedViewBody,
	buildUpdatedSavedViewBody,
	cloneSavedView,
	createAuthenticatedClient,
	createSavedView,
	createTracker,
	deleteSavedView,
	entityField,
	executeQueryEngine,
	findBuiltinSavedView,
	findBuiltinSchemaBySlug,
	getQueryEngineFieldOrThrow,
	getSavedView,
	insertLibraryMembership,
	listEventSchemas,
	listSavedViews,
	literalExpression,
	reorderSavedViews,
	seedMediaEntity,
	updateSavedView,
	waitForEventCount,
} from "../fixtures";

type SavedViewBodyOverrides = NonNullable<
	Parameters<typeof buildSavedViewBody>[0]
>;

const builtinViewError = "Cannot modify built-in saved views";
const missingViewSlug = "non-existent-view-slug";

describe("Saved views E2E", () => {
	it("lists built-in and user-created views together", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, cookies, {
			name: `List Coverage ${crypto.randomUUID()}`,
		});

		const listedViews = await listSavedViews(client, cookies);
		const listedViewIds = listedViews.map((view) => view.id);

		expect(listedViews.some((view) => view.isBuiltin)).toBe(true);
		expect(listedViewIds).toContain(createdView.id);
	});

	it("seeds the Collections built-in view against the collection schema", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const views = await listSavedViews(client, cookies);
		const collectionsView = views.find((view) => view.name === "Collections");

		expect(collectionsView).toBeDefined();
		expect(collectionsView).toMatchObject({
			icon: "folders",
			isBuiltin: true,
			name: "Collections",
			accentColor: "#F59E0B",
			queryDefinition: {
				filter: null,
				eventJoins: [],
				scope: ["collection"],
			},
			displayConfiguration: {
				table: {
					columns: [
						{
							label: "Name",
							expression: createEntityColumnExpression("collection", "name"),
						},
					],
				},
				grid: {
					titleProperty: createEntityColumnExpression("collection", "name"),
					imageProperty: createEntityColumnExpression("collection", "image"),
				},
				list: {
					titleProperty: createEntityColumnExpression("collection", "name"),
					imageProperty: createEntityColumnExpression("collection", "image"),
				},
			},
		});
	});

	it("seeds built-in media views with average user rating callouts", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, cookies, "show");
		const provider = schema.providers[0];
		if (!provider) {
			throw new Error("No provider found");
		}

		const entity = await seedMediaEntity({
			image: null,
			userId: null,
			entitySchemaId: schema.id,
			sandboxScriptId: provider.scriptId,
			name: `Saved View Show ${crypto.randomUUID()}`,
			externalId: `saved-view-show-${crypto.randomUUID()}`,
			properties: {
				genres: [],
				images: [],
				isNsfw: null,
				showSeasons: [],
				sourceUrl: null,
				freeCreators: [],
				description: null,
				publishYear: 2016,
				providerRating: 92.4,
				productionStatus: "Ended",
			},
		});

		await insertLibraryMembership({
			userId,
			mediaEntityId: entity.id,
		});

		const eventSchemas = await listEventSchemas(client, cookies, schema.id);
		const reviewEventSchemaId = eventSchemas.find(
			(item) => item.slug === "review",
		)?.id;
		if (!reviewEventSchemaId) {
			throw new Error("Missing review event schema");
		}

		const createReviews = await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId: entity.id,
					eventSchemaId: reviewEventSchemaId,
					properties: { rating: 2, review: "Okay" },
				},
				{
					entityId: entity.id,
					eventSchemaId: reviewEventSchemaId,
					properties: { rating: 4, review: "Good" },
				},
			],
		});
		expect(createReviews.response.status).toBe(200);
		await waitForEventCount(client, cookies, entity.id, 2);

		const allShowsView = await getSavedView(client, cookies, "all-shows");
		expect(allShowsView.displayConfiguration.grid.calloutProperty).toEqual(
			createEventAggregateExpression("review", ["properties", "rating"], "avg"),
		);

		// all-shows is a built-in entities-mode view
		const allShowsQD = allShowsView.queryDefinition as Extract<
			typeof allShowsView.queryDefinition,
			{ mode: "entities" }
		>;
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				sort: allShowsQD.sort,
				scope: allShowsQD.scope,
				eventJoins: allShowsQD.eventJoins,
				relationships: allShowsQD.relationships,
				computedFields: allShowsQD.computedFields,
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression(entity.name),
					left: createEntityColumnExpression("show", "name"),
				},
				displayConfiguration: {
					...allShowsView.displayConfiguration.grid,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(getQueryEngineFieldOrThrow(data?.data.items[0], "callout")).toEqual({
			value: 3,
			key: "callout",
			kind: "number",
		});
	});

	it("returns built-in all-shows with in-library scoping for each user", async () => {
		const userA = await createAuthenticatedClient();
		const userB = await createAuthenticatedClient();
		const userAView = await getSavedView(
			userA.client,
			userA.cookies,
			"all-shows",
		);
		const userBView = await getSavedView(
			userB.client,
			userB.cookies,
			"all-shows",
		);

		const userAQD = userAView.queryDefinition as Extract<
			typeof userAView.queryDefinition,
			{ mode: "entities" }
		>;
		const userBQD = userBView.queryDefinition as Extract<
			typeof userBView.queryDefinition,
			{ mode: "entities" }
		>;
		expect(userAQD.relationships).toEqual([
			{ relationshipSchemaSlug: "in-library" },
		]);
		expect(userBQD.relationships).toEqual([
			{ relationshipSchemaSlug: "in-library" },
		]);
	});

	it("supports the full create-get-update-clone-delete lifecycle", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, cookies, {
			name: "Lifecycle View",
		});
		const fetchedView = await getSavedView(client, cookies, createdView.slug);

		expect(fetchedView.id).toBe(createdView.id);
		expect(fetchedView.name).toBe("Lifecycle View");
		expect(fetchedView.isBuiltin).toBe(false);
		expect(fetchedView.isDisabled).toBe(false);
		expect(Array.isArray(fetchedView.queryDefinition.scope)).toBe(true);
		expect(fetchedView.queryDefinition.filter).toBeNull();
		expect(Number.isNaN(Date.parse(String(fetchedView.createdAt)))).toBe(false);
		expect(Number.isNaN(Date.parse(String(fetchedView.updatedAt)))).toBe(false);

		const clonedView = await cloneSavedView(client, cookies, createdView.slug);
		expect(clonedView.id).not.toBe(createdView.id);
		expect(clonedView.name).toBe("Lifecycle View (Copy)");
		expect(clonedView.isBuiltin).toBe(false);

		const updatedCloneInput = buildUpdatedSavedViewBody({
			name: "Lifecycle View (Copy) Revised",
			queryDefinition: {
				eventJoins: [],
				computedFields: [],
				scope: ["anime", "manga"],
				sort: {
					direction: "desc",
					expression: createEntityColumnExpression("anime", "createdAt"),
				},
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression("active"),
					left: createEntityPropertyExpression("anime", "productionStatus"),
				},
			},
			displayConfiguration: {
				grid: {
					imageProperty: null,
					titleProperty: null,
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				},
				list: {
					calloutProperty: [entityField("anime", "productionStatus")],
					imageProperty: [
						entityField("anime", "image"),
						entityField("manga", "image"),
					],
					primarySubtitleProperty: [entityField("manga", "publishYear")],
					secondarySubtitleProperty: null,
					titleProperty: [
						entityField("anime", "name"),
						entityField("manga", "name"),
					],
				},
				table: {
					columns: [
						{
							label: "Name",
							property: [
								entityField("anime", "name"),
								entityField("manga", "name"),
							],
						},
						{
							label: "Status",
							property: [entityField("anime", "productionStatus")],
						},
					],
				},
			},
		});
		const updatedClone = await updateSavedView(
			client,
			cookies,
			clonedView.slug,
			updatedCloneInput,
		);
		const fetchedUpdatedClone = await getSavedView(
			client,
			cookies,
			clonedView.slug,
		);

		expect(updatedClone.name).toBe("Lifecycle View (Copy) Revised");
		expect(fetchedUpdatedClone.id).toBe(clonedView.id);
		const { mode: queryMode, ...queryDefinitionWithoutMode } =
			fetchedUpdatedClone.queryDefinition as { mode?: string } & Record<
				string,
				unknown
			>;
		expect(queryMode).toBe("entities");
		const updatedCloneQD = updatedCloneInput.queryDefinition as {
			eventJoins?: unknown[];
			relationships?: unknown[];
		};
		expect(queryDefinitionWithoutMode).toEqual({
			...updatedCloneInput.queryDefinition,
			eventJoins: updatedCloneQD.eventJoins ?? [],
			relationships: updatedCloneQD.relationships ?? [],
		});
		expect(fetchedUpdatedClone.displayConfiguration).toEqual(
			updatedCloneInput.displayConfiguration,
		);

		const deletedOriginal = await deleteSavedView(
			client,
			cookies,
			createdView.slug,
		);
		const deletedClone = await deleteSavedView(
			client,
			cookies,
			clonedView.slug,
		);
		const remainingViews = await listSavedViews(client, cookies);
		const remainingIds = remainingViews.map((view) => view.id);

		expect(deletedOriginal.id).toBe(createdView.id);
		expect(deletedClone.id).toBe(clonedView.id);
		expect(remainingIds).not.toContain(createdView.id);
		expect(remainingIds).not.toContain(clonedView.id);
	});

	it("clones a built-in view into a deletable user view", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinView = await findBuiltinSavedView(client, cookies);
		const clonedView = await cloneSavedView(client, cookies, builtinView.slug);

		expect(clonedView.name).toBe(`${builtinView.name} (Copy)`);
		expect(clonedView.isBuiltin).toBe(false);

		const deletedClone = await deleteSavedView(
			client,
			cookies,
			clonedView.slug,
		);
		const refreshedBuiltin = await getSavedView(
			client,
			cookies,
			builtinView.slug,
		);
		const remainingViews = await listSavedViews(client, cookies);

		expect(deletedClone.id).toBe(clonedView.id);
		expect(refreshedBuiltin.id).toBe(builtinView.id);
		expect(remainingViews.map((view) => view.id)).not.toContain(clonedView.id);
	});

	it("rejects deletes for built-in views", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinView = await findBuiltinSavedView(client, cookies);

		const deleteResult = await client.DELETE("/saved-views/{viewSlug}", {
			headers: { Cookie: cookies },
			params: { path: { viewSlug: builtinView.slug } },
		});

		expect(deleteResult.response.status).toBe(400);
		expect(deleteResult.error?.error?.message).toBe(builtinViewError);
	});

	it("rejects built-in updates that attempt to change fields other than isDisabled", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinView = await findBuiltinSavedView(client, cookies);

		const invalidUpdate = await client.PUT("/saved-views/{viewSlug}", {
			headers: { Cookie: cookies },
			params: { path: { viewSlug: builtinView.slug } },
			body: buildUpdatedSavedViewBody({
				isDisabled: true,
				name: "Attempted Rename",
			}),
		});

		expect(invalidUpdate.response.status).toBe(400);
		expect(invalidUpdate.error?.error?.message).toBe(builtinViewError);

		const disableResult = await client.PUT("/saved-views/{viewSlug}", {
			headers: { Cookie: cookies },
			params: { path: { viewSlug: builtinView.slug } },
			body: {
				icon: builtinView.icon,
				name: builtinView.name,
				isDisabled: true,
				accentColor: builtinView.accentColor,
				queryDefinition: builtinView.queryDefinition,
				displayConfiguration: builtinView.displayConfiguration,
				...(builtinView.trackerId ? { trackerId: builtinView.trackerId } : {}),
			},
		});
		expect(disableResult.response.status).toBe(200);
		expect(disableResult.data?.data.isDisabled).toBe(true);

		const reEnableResult = await client.PUT("/saved-views/{viewSlug}", {
			headers: { Cookie: cookies },
			params: { path: { viewSlug: builtinView.slug } },
			body: {
				icon: builtinView.icon,
				name: builtinView.name,
				isDisabled: false,
				accentColor: builtinView.accentColor,
				queryDefinition: builtinView.queryDefinition,
				displayConfiguration: builtinView.displayConfiguration,
				...(builtinView.trackerId ? { trackerId: builtinView.trackerId } : {}),
			},
		});
		expect(reEnableResult.response.status).toBe(200);
		const fetchedReEnabled = await getSavedView(
			client,
			cookies,
			builtinView.slug,
		);

		expect(fetchedReEnabled.isDisabled).toBe(false);
		expect(fetchedReEnabled.name).toBe(builtinView.name);
	});

	it("returns 404 for missing views across read, update, clone, and delete", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const readResult = await client.GET("/saved-views/{viewSlug}", {
			headers: { Cookie: cookies },
			params: { path: { viewSlug: missingViewSlug } },
		});
		const updateResult = await client.PUT("/saved-views/{viewSlug}", {
			headers: { Cookie: cookies },
			params: { path: { viewSlug: missingViewSlug } },
			body: buildUpdatedSavedViewBody(),
		});
		const cloneResult = await client.POST("/saved-views/{viewSlug}/clone", {
			headers: { Cookie: cookies },
			params: { path: { viewSlug: missingViewSlug } },
		});
		const deleteResult = await client.DELETE("/saved-views/{viewSlug}", {
			headers: { Cookie: cookies },
			params: { path: { viewSlug: missingViewSlug } },
		});

		for (const result of [
			readResult,
			updateResult,
			cloneResult,
			deleteResult,
		]) {
			expect(result.response.status).toBe(404);
			expect(result.error?.error?.message).toBe("Saved view not found");
		}
	});

	it("preserves immutable fields when updating user views", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, cookies, {
			name: "Immutable Fields View",
		});

		await new Promise((resolve) => setTimeout(resolve, 100));
		await updateSavedView(client, cookies, createdView.slug, {
			name: "Immutable Fields View Updated",
		});

		const refreshedView = await getSavedView(client, cookies, createdView.slug);

		expect(refreshedView.id).toBe(createdView.id);
		expect(refreshedView.isBuiltin).toBe(false);
		expect(refreshedView.createdAt).toBe(createdView.createdAt);
		expect(refreshedView.updatedAt).not.toBe(createdView.updatedAt);
	});

	it("supports toggling isDisabled on user views", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, cookies, {
			name: "Disable Toggle View",
		});

		expect(createdView.isDisabled).toBe(false);

		const disabledView = await updateSavedView(
			client,
			cookies,
			createdView.slug,
			{
				isDisabled: true,
			},
		);
		const fetchedDisabled = await getSavedView(
			client,
			cookies,
			createdView.slug,
		);

		expect(disabledView.isDisabled).toBe(true);
		expect(fetchedDisabled.isDisabled).toBe(true);

		const reEnabledView = await updateSavedView(
			client,
			cookies,
			createdView.slug,
			{ isDisabled: false },
		);
		const fetchedReEnabled = await getSavedView(
			client,
			cookies,
			createdView.slug,
		);

		expect(reEnabledView.isDisabled).toBe(false);
		expect(fetchedReEnabled.isDisabled).toBe(false);
	});

	it("lists only enabled saved views by default", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, cookies, {
			name: `Filtered View ${crypto.randomUUID()}`,
		});

		await updateSavedView(client, cookies, createdView.slug, {
			isDisabled: true,
		});

		const listedViews = await listSavedViews(client, cookies);

		expect(listedViews.map((view) => view.id)).not.toContain(createdView.id);
		expect(listedViews.every((view) => !view.isDisabled)).toBe(true);
	});

	it("includes disabled saved views when includeDisabled is true and respects tracker filters", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: `Tracked Views ${crypto.randomUUID()}`,
		});
		const enabledTrackedView = await createSavedView(client, cookies, {
			trackerId,
			name: `Enabled Tracked View ${crypto.randomUUID()}`,
		});
		const disabledTrackedView = await createSavedView(client, cookies, {
			trackerId,
			name: `Disabled Tracked View ${crypto.randomUUID()}`,
		});
		await createSavedView(client, cookies, {
			name: `Standalone View ${crypto.randomUUID()}`,
		});

		await updateSavedView(client, cookies, disabledTrackedView.slug, {
			trackerId,
			isDisabled: true,
		});

		const listedViews = await listSavedViews(client, cookies, {
			trackerId,
			includeDisabled: true,
		});

		expect(new Set(listedViews.map((view) => view.id))).toEqual(
			new Set([disabledTrackedView.id, enabledTrackedView.id]),
		);
		expect(listedViews.map((view) => view.trackerId)).toEqual([
			trackerId,
			trackerId,
		]);
		expect(listedViews.some((view) => view.isDisabled)).toBe(true);
	});

	it("reorders saved views only within the requested tracker scope", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: `Tracker Scoped Views ${crypto.randomUUID()}`,
		});
		const first = await createSavedView(client, cookies, {
			trackerId,
			name: `Tracker View A ${crypto.randomUUID()}`,
		});
		const second = await createSavedView(client, cookies, {
			trackerId,
			name: `Tracker View B ${crypto.randomUUID()}`,
		});
		const standalone = await createSavedView(client, cookies, {
			name: `Standalone View ${crypto.randomUUID()}`,
		});

		const reordered = await reorderSavedViews(client, cookies, {
			viewSlugs: [second.slug, first.slug],
			trackerId,
		});
		const scopedViews = await listSavedViews(client, cookies, {
			trackerId,
			includeDisabled: true,
		});
		const topLevelViews = await listSavedViews(client, cookies, {
			includeDisabled: true,
		});

		expect(reordered.viewSlugs.slice(0, 2)).toEqual([second.slug, first.slug]);
		expect(scopedViews.map((view) => view.slug).slice(0, 2)).toEqual([
			second.slug,
			first.slug,
		]);
		expect(topLevelViews.some((view) => view.id === standalone.id)).toBe(true);
	});

	it("reorders only top-level saved views when trackerId is omitted", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const first = await createSavedView(client, cookies, {
			name: `Top View A ${crypto.randomUUID()}`,
		});
		const second = await createSavedView(client, cookies, {
			name: `Top View B ${crypto.randomUUID()}`,
		});
		const { trackerId } = await createTracker(client, cookies, {
			name: `Unrelated Tracker ${crypto.randomUUID()}`,
		});
		const tracked = await createSavedView(client, cookies, {
			trackerId,
			name: `Tracked Scope View ${crypto.randomUUID()}`,
		});

		await reorderSavedViews(client, cookies, {
			viewSlugs: [second.slug, first.slug],
		});
		const topLevelViews = await listSavedViews(client, cookies, {
			includeDisabled: true,
		});
		const trackedViews = await listSavedViews(client, cookies, {
			trackerId,
			includeDisabled: true,
		});
		const topLevelCreatedSlugsInOrder = topLevelViews
			.filter((view) => view.slug === first.slug || view.slug === second.slug)
			.map((view) => view.slug);

		expect(topLevelCreatedSlugsInOrder).toEqual([second.slug, first.slug]);
		expect(trackedViews.some((view) => view.id === tracked.id)).toBe(true);
	});

	it("moves a saved view to top-level when trackerId is omitted on update", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: `Move View Tracker ${crypto.randomUUID()}`,
		});
		const movedView = await createSavedView(client, cookies, {
			trackerId,
			name: `Movable View ${crypto.randomUUID()}`,
		});

		const updatedView = await updateSavedView(client, cookies, movedView.slug, {
			trackerId: undefined,
			name: `${movedView.name} Updated`,
		});
		const fetchedView = await getSavedView(client, cookies, movedView.slug);
		const topLevelViews = await listSavedViews(client, cookies, {
			includeDisabled: true,
		});
		const trackerViews = await listSavedViews(client, cookies, {
			trackerId,
			includeDisabled: true,
		});

		expect(updatedView.trackerId).toBeNull();
		expect(fetchedView.trackerId).toBeNull();
		expect(topLevelViews.map((view) => view.id)).toContain(movedView.id);
		expect(trackerViews.map((view) => view.id)).not.toContain(movedView.id);
	});

	it("rejects reorder requests containing saved views from another scope", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: `Strict Scope Tracker ${crypto.randomUUID()}`,
		});
		const tracked = await createSavedView(client, cookies, {
			trackerId,
			name: `Scoped View ${crypto.randomUUID()}`,
		});
		const standalone = await createSavedView(client, cookies, {
			name: `Top Scope View ${crypto.randomUUID()}`,
		});

		const result = await client.POST("/saved-views/reorder", {
			headers: { Cookie: cookies },
			body: { trackerId, viewSlugs: [tracked.slug, standalone.slug] },
		});

		expect(result.response.status).toBe(400);
		expect(result.error?.error?.message).toBe(
			"Saved view slugs contain unknown saved views",
		);
	});

	it("rejects empty sort fields when creating or updating saved views", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, cookies, {
			name: "Sort Guard View",
		});

		const createResult = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: buildSavedViewBody({
				name: "Broken Sort View",
				queryDefinition: {
					filter: null,
					eventJoins: [],
					computedFields: [],
					scope: ["book"],
					sort: { expression: literalExpression(null), direction: "asc" },
				},
			}),
		});
		const updateResult = await client.PUT("/saved-views/{viewSlug}", {
			headers: { Cookie: cookies },
			params: { path: { viewSlug: createdView.slug } },
			body: buildUpdatedSavedViewBody({
				queryDefinition: {
					filter: null,
					eventJoins: [],
					computedFields: [],
					scope: ["book"],
					sort: { expression: literalExpression(null), direction: "asc" },
				},
			}),
		});
		const refreshedView = await getSavedView(client, cookies, createdView.slug);
		const refreshedQD = refreshedView.queryDefinition as {
			sort: { expression: unknown };
		};

		expect(createResult.response.status).toBe(400);
		expect(updateResult.response.status).toBe(400);
		expect(createResult.error?.error?.message).toContain(
			"Sort expressions must resolve to a sortable scalar value",
		);
		expect(updateResult.error?.error?.message).toContain(
			"Sort expressions must resolve to a sortable scalar value",
		);
		expect(refreshedQD.sort.expression).toEqual(
			createEntityColumnExpression("book", "name"),
		);
	});

	it("rejects creating saved views with aggregate query definitions", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { data, response, error } = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: buildSavedViewBody({
				name: "Aggregate Stats View",
				queryDefinition: {
					filter: null,
					eventJoins: [],
					scope: ["book"],
					mode: "aggregate",
					relationships: [],
					computedFields: [],
					aggregations: [{ key: "total", aggregation: { type: "count" } }],
				},
			}),
		});

		expect(response.status).toBe(400);
		expect(data).toBeUndefined();
		expect(error?.error?.message).toContain("Invalid input");
	});

	it("persists computed fields across saved view create and update flows", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const nextYearReference = createComputedFieldExpression("nextYear");
		const labelReference = createComputedFieldExpression("label");
		const yearBandReference = createComputedFieldExpression("yearBand");
		const publishYearExpression = createEntityPropertyExpression(
			"book",
			"publishYear",
		);

		const createdView = await createSavedView(client, cookies, {
			name: "Computed Saved View",
			queryDefinition: {
				eventJoins: [],
				scope: ["book"],
				sort: { direction: "desc", expression: nextYearReference },
				filter: {
					operator: "gte",
					type: "comparison",
					left: nextYearReference,
					right: { type: "literal", value: 2021 },
				},
				computedFields: [
					{
						key: "nextYear",
						expression: {
							operator: "add",
							type: "arithmetic",
							left: publishYearExpression,
							right: { type: "literal", value: 1 },
						},
					},
					{
						key: "label",
						expression: {
							type: "concat",
							values: [
								{ type: "literal", value: "Book: " },
								createEntityColumnExpression("book", "name"),
							],
						},
					},
				],
			},
			displayConfiguration: {
				table: {
					columns: [{ label: "Next Year", expression: nextYearReference }],
				},
				grid: {
					calloutProperty: nextYearReference,
					titleProperty: labelReference,
					imageProperty: [entityField("book", "image")],
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				},
				list: {
					calloutProperty: nextYearReference,
					titleProperty: labelReference,
					imageProperty: [entityField("book", "image")],
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				},
			},
		});
		const updatedView = await updateSavedView(
			client,
			cookies,
			createdView.slug,
			{
				name: "Computed Saved View Updated",
				queryDefinition: {
					eventJoins: [],
					scope: ["book"],
					sort: { direction: "desc", expression: nextYearReference },
					filter: {
						type: "comparison",
						operator: "gte",
						left: nextYearReference,
						right: { type: "literal", value: 2021 },
					},
					computedFields: [
						{
							key: "nextYear",
							expression: {
								type: "arithmetic",
								operator: "add",
								left: publishYearExpression,
								right: { type: "literal", value: 1 },
							},
						},
						{
							key: "label",
							expression: {
								type: "concat",
								values: [
									{ type: "literal", value: "Book: " },
									createEntityColumnExpression("book", "name"),
								],
							},
						},
						{
							key: "yearBand",
							expression: {
								type: "conditional",
								whenTrue: { type: "literal", value: "modern" },
								whenFalse: { type: "literal", value: "classic" },
								condition: {
									type: "comparison",
									operator: "gte",
									left: nextYearReference,
									right: { type: "literal", value: 2021 },
								},
							},
						},
					],
				},
				displayConfiguration: {
					table: {
						columns: [{ label: "Band", expression: yearBandReference }],
					},
					grid: {
						calloutProperty: yearBandReference,
						titleProperty: labelReference,
						imageProperty: [entityField("book", "image")],
						primarySubtitleProperty: nextYearReference,
						secondarySubtitleProperty: null,
					},
					list: {
						calloutProperty: yearBandReference,
						titleProperty: labelReference,
						imageProperty: [entityField("book", "image")],
						primarySubtitleProperty: nextYearReference,
						secondarySubtitleProperty: null,
					},
				},
			},
		);
		const fetchedUpdatedView = await getSavedView(
			client,
			cookies,
			createdView.slug,
		);

		expect(createdView.queryDefinition.computedFields).toHaveLength(2);
		expect(updatedView.queryDefinition.computedFields).toHaveLength(3);
		expect(fetchedUpdatedView.name).toBe("Computed Saved View Updated");
		expect(fetchedUpdatedView.queryDefinition).toEqual(
			updatedView.queryDefinition,
		);
		expect(fetchedUpdatedView.displayConfiguration).toEqual(
			updatedView.displayConfiguration,
		);
	});

	it("rejects computed field cycles when creating or updating saved views", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, cookies, {
			name: "Cycle Guard View",
		});

		const invalidQueryDefinition = {
			filter: null,
			eventJoins: [],
			scope: ["book"],
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression("book", "name"),
			},
			computedFields: [
				{
					key: "first",
					expression: createComputedFieldExpression("second"),
				},
				{
					key: "second",
					expression: createComputedFieldExpression("first"),
				},
			],
		} satisfies NonNullable<SavedViewBodyOverrides["queryDefinition"]>;

		const createResult = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: buildSavedViewBody({ queryDefinition: invalidQueryDefinition }),
		});
		const updateResult = await client.PUT("/saved-views/{viewSlug}", {
			headers: { Cookie: cookies },
			params: { path: { viewSlug: createdView.slug } },
			body: buildUpdatedSavedViewBody({
				queryDefinition: invalidQueryDefinition,
			}),
		});

		expect(createResult.response.status).toBe(400);
		expect(updateResult.response.status).toBe(400);
		expect(createResult.error?.error?.message).toBe(
			"Computed field dependency cycle detected: first -> second -> first",
		);
		expect(updateResult.error?.error?.message).toBe(
			"Computed field dependency cycle detected: first -> second -> first",
		);
	});

	it("rejects non-display computed image usage when creating or updating saved views", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, cookies, {
			name: "Image Guard View",
		});

		const invalidQueryDefinition = {
			filter: null,
			eventJoins: [],
			scope: ["book"],
			sort: {
				direction: "asc",
				expression: createComputedFieldExpression("cover"),
			},
			computedFields: [
				{
					key: "cover",
					expression: createEntityColumnExpression("book", "image"),
				},
			],
		} satisfies NonNullable<SavedViewBodyOverrides["queryDefinition"]>;

		const createResult = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: buildSavedViewBody({ queryDefinition: invalidQueryDefinition }),
		});
		const updateResult = await client.PUT("/saved-views/{viewSlug}", {
			headers: { Cookie: cookies },
			params: { path: { viewSlug: createdView.slug } },
			body: buildUpdatedSavedViewBody({
				queryDefinition: invalidQueryDefinition,
			}),
		});

		expect(createResult.response.status).toBe(400);
		expect(updateResult.response.status).toBe(400);
		expect(createResult.error?.error?.message).toBe(
			"Image expressions are display-only and cannot be used in sorting",
		);
		expect(updateResult.error?.error?.message).toBe(
			"Image expressions are display-only and cannot be used in sorting",
		);
	});

	it("rejects unqualified property references when creating or updating saved views", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, cookies, {
			name: "Qualification Guard View",
		});

		const createResult = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: {
				...buildSavedViewBody({ name: "Broken Qualification View" }),
				queryDefinition: {
					eventJoins: [],
					scope: ["book"],
					sort: { direction: "asc", expression: "year" },
					filter: {
						left: "status",
						operator: "eq",
						type: "comparison",
						right: { type: "literal", value: "active" },
					},
				},
			} as never,
		});
		const updateResult = await client.PUT("/saved-views/{viewSlug}", {
			headers: { Cookie: cookies },
			params: { path: { viewSlug: createdView.slug } },
			body: {
				...buildUpdatedSavedViewBody(),
				queryDefinition: {
					eventJoins: [],
					scope: ["book"],
					sort: { direction: "asc", expression: "year" },
					filter: {
						left: "status",
						operator: "eq",
						type: "comparison",
						right: { type: "literal", value: "active" },
					},
				},
			} as never,
		});

		expect(createResult.response.status).toBe(400);
		expect(updateResult.response.status).toBe(400);
		expect(createResult.error?.error?.message).toContain("Invalid input");
		expect(updateResult.error?.error?.message).toContain("Invalid input");
	});

	it("rejects a view referencing a property that does not exist in the schema", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const invalidQueryDefinition = {
			filter: null,
			eventJoins: [],
			computedFields: [],
			scope: ["book"],
			sort: {
				direction: "asc",
				expression: createEntityPropertyExpression(
					"book",
					"nonexistent_property",
				),
			},
		} satisfies NonNullable<SavedViewBodyOverrides["queryDefinition"]>;

		const createResult = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: buildSavedViewBody({ queryDefinition: invalidQueryDefinition }),
		});
		const createdView = await createSavedView(client, cookies);
		const updateResult = await client.PUT("/saved-views/{viewSlug}", {
			headers: { Cookie: cookies },
			params: { path: { viewSlug: createdView.slug } },
			body: buildUpdatedSavedViewBody({
				queryDefinition: invalidQueryDefinition,
			}),
		});

		expect(createResult.response.status).toBe(400);
		expect(updateResult.response.status).toBe(400);
		expect(createResult.error?.error?.message).toContain("not found in schema");
		expect(updateResult.error?.error?.message).toContain("not found in schema");
	});

	it("rejects a view with an invalid built-in column in the display config", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const result = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: buildSavedViewBody({
				displayConfiguration: {
					table: { columns: [] },
					grid: {
						imageProperty: null,
						calloutProperty: null,
						primarySubtitleProperty: null,
						secondarySubtitleProperty: null,
						titleProperty: createEntityColumnExpression("book", "nam"),
					},
					list: {
						imageProperty: null,
						calloutProperty: null,
						primarySubtitleProperty: null,
						secondarySubtitleProperty: null,
						titleProperty: [entityField("book", "name")],
					},
				},
			}),
		});

		expect(result.response.status).toBe(400);
		expect(result.error?.error?.message).toContain(
			"Unsupported entity column 'entity.book.nam'",
		);
	});

	it("rejects a view referencing a schema slug that does not exist", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const result = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: buildSavedViewBody({
				queryDefinition: {
					filter: null,
					eventJoins: [],
					computedFields: [],
					scope: ["does-not-exist"],
					sort: {
						direction: "asc",
						expression: createEntityColumnExpression("does-not-exist", "name"),
					},
				},
			}),
		});

		expect(result.response.status).toBe(400);
		expect(result.error?.error?.message).toContain("not found");
	});
});
