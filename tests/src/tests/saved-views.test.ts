import { describe, expect, it } from "bun:test";
import { getBackendClient, getBackendUrl } from "../setup";

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
				queryDefinition: {
					sort: { direction: "asc", field: ["name"] },
					entitySchemaSlugs: ["book"],
					filters: [],
				},
				displayConfiguration: {
					layout: "grid",
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
					table: { columns: [] },
				},
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
