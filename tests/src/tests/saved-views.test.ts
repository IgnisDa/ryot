import { describe, expect, it } from "bun:test";
import {
	buildSavedViewBody,
	buildUpdatedSavedViewBody,
	cloneSavedView,
	computedFieldExpression,
	createAuthenticatedClient,
	createSavedView,
	createTracker,
	deleteSavedView,
	entityColumnExpression,
	entityField,
	findBuiltinSavedView,
	getSavedView,
	listSavedViews,
	literalExpression,
	reorderSavedViews,
	schemaPropertyExpression,
	updateSavedView,
} from "../fixtures";

type SavedViewBodyOverrides = NonNullable<
	Parameters<typeof buildSavedViewBody>[0]
>;

const builtinViewError = "Cannot modify built-in saved views";
const missingViewId = "00000000-0000-0000-0000-000000000000";

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
				entitySchemaSlugs: ["collection"],
			},
			displayConfiguration: {
				table: {
					columns: [
						{
							label: "Name",
							expression: entityColumnExpression("collection", "name"),
						},
					],
				},
				grid: {
					titleProperty: entityColumnExpression("collection", "name"),
					imageProperty: entityColumnExpression("collection", "image"),
				},
				list: {
					titleProperty: entityColumnExpression("collection", "name"),
					imageProperty: entityColumnExpression("collection", "image"),
				},
			},
		});
	});

	it("supports the full create-get-update-clone-delete lifecycle", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, cookies, {
			name: "Lifecycle View",
		});
		const fetchedView = await getSavedView(client, cookies, createdView.id);

		expect(fetchedView.id).toBe(createdView.id);
		expect(fetchedView.name).toBe("Lifecycle View");
		expect(fetchedView.isBuiltin).toBe(false);
		expect(fetchedView.isDisabled).toBe(false);
		expect(Array.isArray(fetchedView.queryDefinition.entitySchemaSlugs)).toBe(
			true,
		);
		expect(fetchedView.queryDefinition.filter).toBeNull();
		expect(Number.isNaN(Date.parse(String(fetchedView.createdAt)))).toBe(false);
		expect(Number.isNaN(Date.parse(String(fetchedView.updatedAt)))).toBe(false);

		const clonedView = await cloneSavedView(client, cookies, createdView.id);
		expect(clonedView.id).not.toBe(createdView.id);
		expect(clonedView.name).toBe("Lifecycle View (Copy)");
		expect(clonedView.isBuiltin).toBe(false);

		const updatedCloneInput = buildUpdatedSavedViewBody({
			name: "Lifecycle View (Copy) Revised",
			queryDefinition: {
				eventJoins: [],
				computedFields: [],
				entitySchemaSlugs: ["anime", "manga"],
				sort: {
					direction: "desc",
					expression: entityColumnExpression("anime", "createdAt"),
				},
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression("active"),
					left: schemaPropertyExpression("anime", "productionStatus"),
				},
			},
			displayConfiguration: {
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					subtitleProperty: [entityField("manga", "publishYear")],
					badgeProperty: [entityField("anime", "productionStatus")],
					imageProperty: [
						entityField("anime", "image"),
						entityField("manga", "image"),
					],
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
			clonedView.id,
			updatedCloneInput,
		);
		const fetchedUpdatedClone = await getSavedView(
			client,
			cookies,
			clonedView.id,
		);

		expect(updatedClone.name).toBe("Lifecycle View (Copy) Revised");
		expect(fetchedUpdatedClone.id).toBe(clonedView.id);
		expect(fetchedUpdatedClone.queryDefinition).toEqual({
			...updatedCloneInput.queryDefinition,
			eventJoins: updatedCloneInput.queryDefinition.eventJoins ?? [],
		});
		expect(fetchedUpdatedClone.displayConfiguration).toEqual(
			updatedCloneInput.displayConfiguration,
		);

		const deletedOriginal = await deleteSavedView(
			client,
			cookies,
			createdView.id,
		);
		const deletedClone = await deleteSavedView(client, cookies, clonedView.id);
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
		const clonedView = await cloneSavedView(client, cookies, builtinView.id);

		expect(clonedView.name).toBe(`${builtinView.name} (Copy)`);
		expect(clonedView.isBuiltin).toBe(false);

		const deletedClone = await deleteSavedView(client, cookies, clonedView.id);
		const refreshedBuiltin = await getSavedView(
			client,
			cookies,
			builtinView.id,
		);
		const remainingViews = await listSavedViews(client, cookies);

		expect(deletedClone.id).toBe(clonedView.id);
		expect(refreshedBuiltin.id).toBe(builtinView.id);
		expect(remainingViews.map((view) => view.id)).not.toContain(clonedView.id);
	});

	it("rejects deletes for built-in views", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinView = await findBuiltinSavedView(client, cookies);

		const deleteResult = await client.DELETE("/saved-views/{viewId}", {
			headers: { Cookie: cookies },
			params: { path: { viewId: builtinView.id } },
		});

		expect(deleteResult.response.status).toBe(400);
		expect(deleteResult.error?.error?.message).toBe(builtinViewError);
	});

	it("rejects built-in updates that attempt to change fields other than isDisabled", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinView = await findBuiltinSavedView(client, cookies);

		const invalidUpdate = await client.PUT("/saved-views/{viewId}", {
			headers: { Cookie: cookies },
			params: { path: { viewId: builtinView.id } },
			body: buildUpdatedSavedViewBody({
				isDisabled: true,
				name: "Attempted Rename",
			}),
		});

		expect(invalidUpdate.response.status).toBe(400);
		expect(invalidUpdate.error?.error?.message).toBe(builtinViewError);

		const disableResult = await client.PUT("/saved-views/{viewId}", {
			headers: { Cookie: cookies },
			params: { path: { viewId: builtinView.id } },
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

		const reEnableResult = await client.PUT("/saved-views/{viewId}", {
			headers: { Cookie: cookies },
			params: { path: { viewId: builtinView.id } },
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
			builtinView.id,
		);

		expect(fetchedReEnabled.isDisabled).toBe(false);
		expect(fetchedReEnabled.name).toBe(builtinView.name);
	});

	it("returns 404 for missing views across read, update, clone, and delete", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const readResult = await client.GET("/saved-views/{viewId}", {
			headers: { Cookie: cookies },
			params: { path: { viewId: missingViewId } },
		});
		const updateResult = await client.PUT("/saved-views/{viewId}", {
			headers: { Cookie: cookies },
			params: { path: { viewId: missingViewId } },
			body: buildUpdatedSavedViewBody(),
		});
		const cloneResult = await client.POST("/saved-views/{viewId}/clone", {
			headers: { Cookie: cookies },
			params: { path: { viewId: missingViewId } },
		});
		const deleteResult = await client.DELETE("/saved-views/{viewId}", {
			headers: { Cookie: cookies },
			params: { path: { viewId: missingViewId } },
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
		await updateSavedView(client, cookies, createdView.id, {
			name: "Immutable Fields View Updated",
		});

		const refreshedView = await getSavedView(client, cookies, createdView.id);

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
			createdView.id,
			{
				isDisabled: true,
			},
		);
		const fetchedDisabled = await getSavedView(client, cookies, createdView.id);

		expect(disabledView.isDisabled).toBe(true);
		expect(fetchedDisabled.isDisabled).toBe(true);

		const reEnabledView = await updateSavedView(
			client,
			cookies,
			createdView.id,
			{ isDisabled: false },
		);
		const fetchedReEnabled = await getSavedView(
			client,
			cookies,
			createdView.id,
		);

		expect(reEnabledView.isDisabled).toBe(false);
		expect(fetchedReEnabled.isDisabled).toBe(false);
	});

	it("lists only enabled saved views by default", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const createdView = await createSavedView(client, cookies, {
			name: `Filtered View ${crypto.randomUUID()}`,
		});

		await updateSavedView(client, cookies, createdView.id, {
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

		await updateSavedView(client, cookies, disabledTrackedView.id, {
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
			viewIds: [second.id, first.id],
			trackerId,
		});
		const scopedViews = await listSavedViews(client, cookies, {
			trackerId,
			includeDisabled: true,
		});
		const topLevelViews = await listSavedViews(client, cookies, {
			includeDisabled: true,
		});

		expect(reordered.viewIds.slice(0, 2)).toEqual([second.id, first.id]);
		expect(scopedViews.map((view) => view.id).slice(0, 2)).toEqual([
			second.id,
			first.id,
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
			viewIds: [second.id, first.id],
		});
		const topLevelViews = await listSavedViews(client, cookies, {
			includeDisabled: true,
		});
		const trackedViews = await listSavedViews(client, cookies, {
			trackerId,
			includeDisabled: true,
		});
		const topLevelCreatedIdsInOrder = topLevelViews
			.filter((view) => view.id === first.id || view.id === second.id)
			.map((view) => view.id);

		expect(topLevelCreatedIdsInOrder).toEqual([second.id, first.id]);
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

		const updatedView = await updateSavedView(client, cookies, movedView.id, {
			trackerId: undefined,
			name: `${movedView.name} Updated`,
		});
		const fetchedView = await getSavedView(client, cookies, movedView.id);
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
			body: { trackerId, viewIds: [tracked.id, standalone.id] },
		});

		expect(result.response.status).toBe(400);
		expect(result.error?.error?.message).toBe(
			"Saved view ids contain unknown saved views",
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
					entitySchemaSlugs: ["book"],
					sort: { expression: literalExpression(null), direction: "asc" },
				},
			}),
		});
		const updateResult = await client.PUT("/saved-views/{viewId}", {
			headers: { Cookie: cookies },
			params: { path: { viewId: createdView.id } },
			body: buildUpdatedSavedViewBody({
				queryDefinition: {
					filter: null,
					eventJoins: [],
					computedFields: [],
					entitySchemaSlugs: ["book"],
					sort: { expression: literalExpression(null), direction: "asc" },
				},
			}),
		});
		const refreshedView = await getSavedView(client, cookies, createdView.id);

		expect(createResult.response.status).toBe(400);
		expect(updateResult.response.status).toBe(400);
		expect(createResult.error?.error?.message).toContain(
			"Sort expressions must resolve to a sortable scalar value",
		);
		expect(updateResult.error?.error?.message).toContain(
			"Sort expressions must resolve to a sortable scalar value",
		);
		expect(refreshedView.queryDefinition.sort.expression).toEqual(
			entityColumnExpression("book", "name"),
		);
	});

	it("persists computed fields across saved view create and update flows", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const nextYearReference = computedFieldExpression("nextYear");
		const labelReference = computedFieldExpression("label");
		const yearBandReference = computedFieldExpression("yearBand");
		const publishYearExpression = schemaPropertyExpression(
			"book",
			"publishYear",
		);

		const createdView = await createSavedView(client, cookies, {
			name: "Computed Saved View",
			queryDefinition: {
				eventJoins: [],
				entitySchemaSlugs: ["book"],
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
								entityColumnExpression("book", "name"),
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
					badgeProperty: nextYearReference,
					subtitleProperty: null,
					titleProperty: labelReference,
					imageProperty: [entityField("book", "image")],
				},
				list: {
					badgeProperty: nextYearReference,
					subtitleProperty: null,
					titleProperty: labelReference,
					imageProperty: [entityField("book", "image")],
				},
			},
		});
		const updatedView = await updateSavedView(client, cookies, createdView.id, {
			name: "Computed Saved View Updated",
			queryDefinition: {
				eventJoins: [],
				entitySchemaSlugs: ["book"],
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
								entityColumnExpression("book", "name"),
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
					badgeProperty: yearBandReference,
					subtitleProperty: nextYearReference,
					titleProperty: labelReference,
					imageProperty: [entityField("book", "image")],
				},
				list: {
					badgeProperty: yearBandReference,
					subtitleProperty: nextYearReference,
					titleProperty: labelReference,
					imageProperty: [entityField("book", "image")],
				},
			},
		});
		const fetchedUpdatedView = await getSavedView(
			client,
			cookies,
			createdView.id,
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
			entitySchemaSlugs: ["book"],
			sort: {
				direction: "asc",
				expression: entityColumnExpression("book", "name"),
			},
			computedFields: [
				{
					key: "first",
					expression: computedFieldExpression("second"),
				},
				{
					key: "second",
					expression: computedFieldExpression("first"),
				},
			],
		} satisfies NonNullable<SavedViewBodyOverrides["queryDefinition"]>;

		const createResult = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: buildSavedViewBody({ queryDefinition: invalidQueryDefinition }),
		});
		const updateResult = await client.PUT("/saved-views/{viewId}", {
			headers: { Cookie: cookies },
			params: { path: { viewId: createdView.id } },
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
			entitySchemaSlugs: ["book"],
			sort: {
				direction: "asc",
				expression: computedFieldExpression("cover"),
			},
			computedFields: [
				{
					key: "cover",
					expression: entityColumnExpression("book", "image"),
				},
			],
		} satisfies NonNullable<SavedViewBodyOverrides["queryDefinition"]>;

		const createResult = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: buildSavedViewBody({ queryDefinition: invalidQueryDefinition }),
		});
		const updateResult = await client.PUT("/saved-views/{viewId}", {
			headers: { Cookie: cookies },
			params: { path: { viewId: createdView.id } },
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
					entitySchemaSlugs: ["book"],
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
		const updateResult = await client.PUT("/saved-views/{viewId}", {
			headers: { Cookie: cookies },
			params: { path: { viewId: createdView.id } },
			body: {
				...buildUpdatedSavedViewBody(),
				queryDefinition: {
					eventJoins: [],
					entitySchemaSlugs: ["book"],
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
			entitySchemaSlugs: ["book"],
			sort: {
				direction: "asc",
				expression: schemaPropertyExpression("book", "nonexistent_property"),
			},
		} satisfies NonNullable<SavedViewBodyOverrides["queryDefinition"]>;

		const createResult = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: buildSavedViewBody({ queryDefinition: invalidQueryDefinition }),
		});
		const createdView = await createSavedView(client, cookies);
		const updateResult = await client.PUT("/saved-views/{viewId}", {
			headers: { Cookie: cookies },
			params: { path: { viewId: createdView.id } },
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
						badgeProperty: null,
						subtitleProperty: null,
						titleProperty: entityColumnExpression("book", "nam"),
					},
					list: {
						imageProperty: null,
						badgeProperty: null,
						subtitleProperty: null,
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
					entitySchemaSlugs: ["does-not-exist"],
					sort: {
						direction: "asc",
						expression: entityColumnExpression("does-not-exist", "name"),
					},
				},
			}),
		});

		expect(result.response.status).toBe(400);
		expect(result.error?.error?.message).toContain("not found");
	});
});
