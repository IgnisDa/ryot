import { describe, expect, it } from "bun:test";
import { createAuthenticatedClient, createTracker } from "../helpers";
import {
	buildSavedViewBody,
	buildUpdatedSavedViewBody,
	cloneSavedView,
	createSavedView,
	deleteSavedView,
	findBuiltinSavedView,
	getSavedView,
	listSavedViews,
	updateSavedView,
} from "../test-support/saved-views";

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
		expect(Array.isArray(fetchedView.queryDefinition.filters)).toBe(true);
		expect(Number.isNaN(Date.parse(String(fetchedView.createdAt)))).toBe(false);
		expect(Number.isNaN(Date.parse(String(fetchedView.updatedAt)))).toBe(false);

		const clonedView = await cloneSavedView(client, cookies, createdView.id);
		expect(clonedView.id).not.toBe(createdView.id);
		expect(clonedView.name).toBe("Lifecycle View (Copy)");
		expect(clonedView.isBuiltin).toBe(false);

		const updatedCloneInput = buildUpdatedSavedViewBody({
			name: "Lifecycle View (Copy) Revised",
			queryDefinition: {
				filters: [{ op: "eq", field: ["status"], value: "active" }],
				entitySchemaSlugs: ["anime", "manga"],
				sort: { field: ["@createdAt"], direction: "desc" },
			},
			displayConfiguration: {
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["status"],
					subtitleProperty: ["year"],
				},
				table: {
					columns: [{ property: ["@name"] }, { property: ["status"] }],
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
		expect(fetchedUpdatedClone.queryDefinition).toEqual(
			updatedCloneInput.queryDefinition,
		);
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

	it("allows toggling isDisabled on a built-in view without changing other fields", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const builtinView = await findBuiltinSavedView(client, cookies);

		const disabledView = await updateSavedView(
			client,
			cookies,
			builtinView.id,
			{ isDisabled: true, name: "Attempted Rename" },
		);
		const fetchedDisabled = await getSavedView(client, cookies, builtinView.id);

		expect(disabledView.isDisabled).toBe(true);
		expect(disabledView.name).toBe(builtinView.name);
		expect(fetchedDisabled.isDisabled).toBe(true);
		expect(fetchedDisabled.name).toBe(builtinView.name);

		await updateSavedView(client, cookies, builtinView.id, {
			isDisabled: false,
		});
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
					filters: [],
					entitySchemaSlugs: ["book"],
					sort: { field: [], direction: "asc" },
				},
			}),
		});
		const updateResult = await client.PUT("/saved-views/{viewId}", {
			headers: { Cookie: cookies },
			params: { path: { viewId: createdView.id } },
			body: buildUpdatedSavedViewBody({
				queryDefinition: {
					filters: [],
					entitySchemaSlugs: ["book"],
					sort: { field: [], direction: "asc" },
				},
			}),
		});
		const refreshedView = await getSavedView(client, cookies, createdView.id);

		expect(createResult.response.status).toBe(400);
		expect(updateResult.response.status).toBe(400);
		expect(createResult.error?.error?.message).toContain(
			"Sort field is required",
		);
		expect(updateResult.error?.error?.message).toContain(
			"Sort field is required",
		);
		expect(refreshedView.queryDefinition.sort.field).toEqual(["@name"]);
	});
});
