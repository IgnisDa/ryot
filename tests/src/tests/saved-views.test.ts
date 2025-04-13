import { describe, expect, it } from "bun:test";
import { getBackendClient, getBackendUrl } from "../setup";

const emptyDisplayConfiguration = {
	table: { columns: [] },
	layout: "grid" as const,
	grid: {
		imageProperty: null,
		titleProperty: null,
		badgeProperty: null,
		subtitleProperty: null,
	},
	list: {
		imageProperty: null,
		titleProperty: null,
		badgeProperty: null,
		subtitleProperty: null,
	},
};

const basicQueryDefinition = {
	filters: [],
	entitySchemaSlugs: ["book"],
	sort: { direction: "asc" as const, field: ["name"] },
};

async function createTestUser() {
	const baseUrl = getBackendUrl();
	const timestamp = Date.now();
	const email = `test-${timestamp}@example.com`;
	const password = "password123";

	const signUpResponse = await fetch(`${baseUrl}/authentication/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, name: "Test User", password }),
	});

	if (!signUpResponse.ok) {
		const error = await signUpResponse.text();
		throw new Error(`Sign up failed: ${error}`);
	}

	const signInResponse = await fetch(`${baseUrl}/auth/sign-in/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	});

	if (!signInResponse.ok) {
		const error = await signInResponse.text();
		throw new Error(`Sign in failed: ${error}`);
	}

	const cookies = signInResponse.headers.get("set-cookie");
	if (!cookies) throw new Error("Failed to get auth cookies");

	return { cookies };
}

describe("GET /saved-views/{viewId}", () => {
	it("returns 200 for existing built-in view", async () => {
		const client = getBackendClient();
		const { cookies } = await createTestUser();

		const { data: listData } = await client.GET("/saved-views", {
			headers: { Cookie: cookies },
		});

		const builtinView = listData?.data?.find((view) => view.isBuiltin);
		expect(builtinView).toBeDefined();
		if (!builtinView) throw new Error("Built-in view not found");

		const { data, response } = await client.GET("/saved-views/{viewId}", {
			params: { path: { viewId: builtinView.id } },
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(data?.data?.id).toBe(builtinView.id);
	});

	it("returns 404 for non-existent view ID", async () => {
		const client = getBackendClient();
		const { cookies } = await createTestUser();

		const nonExistentId = "00000000-0000-0000-0000-000000000000";
		const { response, error } = await client.GET("/saved-views/{viewId}", {
			params: { path: { viewId: nonExistentId } },
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(404);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe("Saved view not found");
	});

	it("returns 200 for user-owned view", async () => {
		const client = getBackendClient();
		const { cookies } = await createTestUser();

		const { data: createData } = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: {
				icon: "star",
				name: "My Custom View",
				accentColor: "#FF5733",
				queryDefinition: basicQueryDefinition,
				displayConfiguration: emptyDisplayConfiguration,
			},
		});

		const userViewId = createData?.data?.id;
		expect(userViewId).toBeDefined();
		if (!userViewId) throw new Error("Failed to create user view");

		const { data, response } = await client.GET("/saved-views/{viewId}", {
			params: { path: { viewId: userViewId } },
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(data?.data?.id).toBe(userViewId);
		expect(data?.data?.name).toBe("My Custom View");
		expect(data?.data?.isBuiltin).toBe(false);
	});

	it("returns complete response structure with all required fields", async () => {
		const client = getBackendClient();
		const { cookies } = await createTestUser();

		const { data: listData } = await client.GET("/saved-views", {
			headers: { Cookie: cookies },
		});

		const firstView = listData?.data?.[0];
		expect(firstView).toBeDefined();
		if (!firstView) throw new Error("First view not found");

		const { data } = await client.GET("/saved-views/{viewId}", {
			params: { path: { viewId: firstView.id } },
			headers: { Cookie: cookies },
		});

		const view = data?.data;
		expect(view).toBeDefined();

		expect(view?.id).toBeDefined();
		expect(view?.name).toBeDefined();
		expect(typeof view?.isBuiltin).toBe("boolean");
		expect(view?.icon).toBeDefined();
		expect(view?.accentColor).toBeDefined();

		expect(view?.queryDefinition).toBeDefined();
		expect(Array.isArray(view?.queryDefinition.entitySchemaSlugs)).toBe(true);
		expect(Array.isArray(view?.queryDefinition.filters)).toBe(true);
		expect(view?.queryDefinition.sort).toBeDefined();
		expect(view?.queryDefinition.sort.field).toBeDefined();
		expect(view?.queryDefinition.sort.direction).toBeDefined();

		expect(view?.displayConfiguration).toBeDefined();
		expect(view?.displayConfiguration.layout).toBeDefined();
		expect(view?.displayConfiguration.grid).toBeDefined();
		expect(view?.displayConfiguration.list).toBeDefined();
		expect(view?.displayConfiguration.table).toBeDefined();
		expect(Array.isArray(view?.displayConfiguration.table.columns)).toBe(true);
	});
});

describe("PUT /saved-views/{viewId}", () => {
	it("updates view successfully and returns 200", async () => {
		const client = getBackendClient();
		const { cookies } = await createTestUser();

		const { data: createData } = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: {
				icon: "star",
				name: "Original Name",
				accentColor: "#FF5733",
				queryDefinition: basicQueryDefinition,
				displayConfiguration: emptyDisplayConfiguration,
			},
		});

		const viewId = createData?.data?.id;
		expect(viewId).toBeDefined();
		if (!viewId) throw new Error("Failed to create view");

		const { data, response } = await client.PUT("/saved-views/{viewId}", {
			params: { path: { viewId } },
			headers: { Cookie: cookies },
			body: {
				icon: "heart",
				name: "Updated Name",
				accentColor: "#00FF00",
				queryDefinition: {
					filters: [],
					entitySchemaSlugs: ["anime"],
					sort: { direction: "desc", field: ["createdAt"] },
				},
				displayConfiguration: {
					layout: "list",
					table: { columns: [] },
					grid: {
						imageProperty: null,
						titleProperty: null,
						badgeProperty: null,
						subtitleProperty: null,
					},
					list: {
						badgeProperty: null,
						subtitleProperty: null,
						imageProperty: ["@name"],
						titleProperty: ["@name"],
					},
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(data?.data?.name).toBe("Updated Name");
	});

	it("returns 404 for non-existent view", async () => {
		const client = getBackendClient();
		const { cookies } = await createTestUser();

		const nonExistentId = "00000000-0000-0000-0000-000000000000";
		const { response, error } = await client.PUT("/saved-views/{viewId}", {
			params: { path: { viewId: nonExistentId } },
			headers: { Cookie: cookies },
			body: {
				icon: "heart",
				name: "Updated Name",
				accentColor: "#00FF00",
				queryDefinition: basicQueryDefinition,
				displayConfiguration: emptyDisplayConfiguration,
			},
		});

		expect(response.status).toBe(404);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe("Saved view not found");
	});

	it("preserves immutable fields (id, isBuiltin)", async () => {
		const client = getBackendClient();
		const { cookies } = await createTestUser();

		const { data: createData } = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: {
				icon: "star",
				name: "Original Name",
				accentColor: "#FF5733",
				queryDefinition: basicQueryDefinition,
				displayConfiguration: emptyDisplayConfiguration,
			},
		});

		const originalId = createData?.data?.id;
		const originalIsBuiltin = createData?.data?.isBuiltin;
		expect(originalId).toBeDefined();
		expect(originalIsBuiltin).toBe(false);
		if (!originalId) throw new Error("Failed to create view");

		await client.PUT("/saved-views/{viewId}", {
			params: { path: { viewId: originalId } },
			headers: { Cookie: cookies },
			body: {
				icon: "heart",
				name: "Completely Different Name",
				accentColor: "#00FF00",
				queryDefinition: basicQueryDefinition,
				displayConfiguration: emptyDisplayConfiguration,
			},
		});

		const { data: fetchData } = await client.GET("/saved-views/{viewId}", {
			params: { path: { viewId: originalId } },
			headers: { Cookie: cookies },
		});

		expect(fetchData?.data?.id).toBe(originalId);
		expect(fetchData?.data?.isBuiltin).toBe(originalIsBuiltin);
	});

	it("updates updatedAt timestamp and preserves createdAt", async () => {
		const client = getBackendClient();
		const { cookies } = await createTestUser();

		const { data: createData } = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: {
				icon: "star",
				name: "Original Name",
				accentColor: "#FF5733",
				queryDefinition: basicQueryDefinition,
				displayConfiguration: emptyDisplayConfiguration,
			},
		});

		const viewId = createData?.data?.id;
		const originalCreatedAt = createData?.data?.createdAt;
		const originalUpdatedAt = createData?.data?.updatedAt;
		expect(viewId).toBeDefined();
		expect(originalCreatedAt).toBeDefined();
		expect(originalUpdatedAt).toBeDefined();
		if (!viewId) throw new Error("Failed to create view");

		await new Promise((resolve) => setTimeout(resolve, 100));

		await client.PUT("/saved-views/{viewId}", {
			params: { path: { viewId } },
			headers: { Cookie: cookies },
			body: {
				icon: "heart",
				name: "Updated Name",
				accentColor: "#00FF00",
				queryDefinition: basicQueryDefinition,
				displayConfiguration: emptyDisplayConfiguration,
			},
		});

		const { data: fetchData } = await client.GET("/saved-views/{viewId}", {
			params: { path: { viewId } },
			headers: { Cookie: cookies },
		});

		expect(fetchData?.data?.createdAt).toBe(originalCreatedAt);
		expect(fetchData?.data?.updatedAt).not.toBe(originalUpdatedAt);
		expect(new Date(fetchData?.data?.updatedAt || 0).getTime()).toBeGreaterThan(
			new Date(originalUpdatedAt || 0).getTime(),
		);
	});

	it("updates all mutable fields when fetched via GET", async () => {
		const client = getBackendClient();
		const { cookies } = await createTestUser();

		const { data: createData } = await client.POST("/saved-views", {
			headers: { Cookie: cookies },
			body: {
				icon: "star",
				name: "Original Name",
				accentColor: "#FF5733",
				trackerId: undefined,
				queryDefinition: {
					sort: { direction: "asc", field: ["name"] },
					entitySchemaSlugs: ["book"],
					filters: [],
				},
				displayConfiguration: {
					layout: "grid",
					grid: {
						imageProperty: ["@image"],
						titleProperty: ["@name"],
						badgeProperty: null,
						subtitleProperty: null,
					},
					list: {
						imageProperty: null,
						titleProperty: null,
						badgeProperty: null,
						subtitleProperty: null,
					},
					table: { columns: [] },
				},
			},
		});

		const viewId = createData?.data?.id;
		expect(viewId).toBeDefined();
		if (!viewId) throw new Error("Failed to create view");

		await client.PUT("/saved-views/{viewId}", {
			params: { path: { viewId } },
			headers: { Cookie: cookies },
			body: {
				icon: "heart",
				name: "Completely Different Name",
				accentColor: "#00FF00",
				queryDefinition: {
					sort: { direction: "desc", field: ["createdAt"] },
					entitySchemaSlugs: ["anime", "manga"],
					filters: [
						{
							op: "eq",
							field: ["status"],
							value: "completed",
						},
					],
				},
				displayConfiguration: {
					layout: "list",
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
			},
		});

		const { data: fetchData } = await client.GET("/saved-views/{viewId}", {
			params: { path: { viewId } },
			headers: { Cookie: cookies },
		});

		const view = fetchData?.data;
		expect(view).toBeDefined();
		expect(view?.name).toBe("Completely Different Name");
		expect(view?.icon).toBe("heart");
		expect(view?.accentColor).toBe("#00FF00");
		expect(view?.queryDefinition.sort.direction).toBe("desc");
		expect(view?.queryDefinition.sort.field).toEqual(["createdAt"]);
		expect(view?.queryDefinition.entitySchemaSlugs).toEqual(["anime", "manga"]);
		expect(view?.queryDefinition.filters).toHaveLength(1);
		expect(view?.queryDefinition.filters[0]).toEqual({
			op: "eq",
			field: ["status"],
			value: "completed",
		});
		expect(view?.displayConfiguration.layout).toBe("list");
		expect(view?.displayConfiguration.list.imageProperty).toEqual(["@image"]);
		expect(view?.displayConfiguration.list.titleProperty).toEqual(["@name"]);
		expect(view?.displayConfiguration.list.badgeProperty).toEqual(["status"]);
		expect(view?.displayConfiguration.list.subtitleProperty).toEqual(["year"]);
		expect(view?.displayConfiguration.table.columns).toHaveLength(2);
	});

	it("returns 400 when attempting to update a builtin view", async () => {
		const client = getBackendClient();
		const { cookies } = await createTestUser();

		const { data: listData } = await client.GET("/saved-views", {
			headers: { Cookie: cookies },
		});

		const builtinView = listData?.data?.find((view) => view.isBuiltin);
		expect(builtinView).toBeDefined();
		if (!builtinView) throw new Error("Built-in view not found");

		const { response, error } = await client.PUT("/saved-views/{viewId}", {
			params: { path: { viewId: builtinView.id } },
			headers: { Cookie: cookies },
			body: {
				icon: "heart",
				name: "Hacked Name",
				accentColor: "#00FF00",
				queryDefinition: basicQueryDefinition,
				displayConfiguration: emptyDisplayConfiguration,
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe("Cannot modify built-in saved views");
	});
});
