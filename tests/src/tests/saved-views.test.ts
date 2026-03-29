import { describe, expect, it } from "bun:test";
import type { paths } from "@ryot/generated/openapi/app-backend";
import type createClient from "openapi-fetch";
import {
	basicQueryDefinition,
	createAuthenticatedClient,
	emptyDisplayConfiguration,
} from "../helpers";

type Client = ReturnType<typeof createClient<paths>>;

interface CreateSavedViewOptions {
	icon?: string;
	name?: string;
	accentColor?: string;
	queryDefinition?: any;
	displayConfiguration?: any;
}

async function createSavedView(
	client: Client,
	cookies: string,
	options: CreateSavedViewOptions = {},
) {
	const {
		icon = "star",
		name = "Test View",
		accentColor = "#FF5733",
		queryDefinition = basicQueryDefinition,
		displayConfiguration = emptyDisplayConfiguration,
	} = options;

	const { data } = await client.POST("/saved-views", {
		headers: { Cookie: cookies },
		body: {
			icon,
			name,
			accentColor,
			queryDefinition,
			displayConfiguration,
		},
	});

	const viewId = data?.data?.id;
	if (!viewId) throw new Error("Failed to create saved view");

	return { viewId, data: data.data };
}

async function findBuiltinView(client: Client, cookies: string) {
	const { data: listData } = await client.GET("/saved-views", {
		headers: { Cookie: cookies },
	});

	const builtinView = listData?.data?.find((view) => view.isBuiltin);
	if (!builtinView) throw new Error("Built-in view not found");

	return builtinView;
}

describe("GET /saved-views/{viewId}", () => {
	it("returns 200 for existing built-in view", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const builtinView = await findBuiltinView(client, cookies);

		const { data, response } = await client.GET("/saved-views/{viewId}", {
			params: { path: { viewId: builtinView.id } },
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(data?.data?.id).toBe(builtinView.id);
	});

	it("returns 404 for non-existent view ID", async () => {
		const { client, cookies } = await createAuthenticatedClient();

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
		const { client, cookies } = await createAuthenticatedClient();

		const { viewId } = await createSavedView(client, cookies, {
			name: "My Custom View",
		});

		const { data, response } = await client.GET("/saved-views/{viewId}", {
			params: { path: { viewId } },
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(data?.data?.id).toBe(viewId);
		expect(data?.data?.name).toBe("My Custom View");
		expect(data?.data?.isBuiltin).toBe(false);
	});

	it("returns complete response structure with all required fields", async () => {
		const { client, cookies } = await createAuthenticatedClient();

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
		const { client, cookies } = await createAuthenticatedClient();

		const { viewId } = await createSavedView(client, cookies, {
			name: "Original Name",
		});

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
		const { client, cookies } = await createAuthenticatedClient();

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
		const { client, cookies } = await createAuthenticatedClient();

		const { viewId: originalId, data: originalData } = await createSavedView(
			client,
			cookies,
			{ name: "Original Name" },
		);

		const originalIsBuiltin = originalData?.isBuiltin;
		expect(originalIsBuiltin).toBe(false);

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
		const { client, cookies } = await createAuthenticatedClient();

		const { viewId, data: createData } = await createSavedView(
			client,
			cookies,
			{
				name: "Original Name",
			},
		);

		const originalCreatedAt = createData?.createdAt;
		const originalUpdatedAt = createData?.updatedAt;
		expect(originalCreatedAt).toBeDefined();
		expect(originalUpdatedAt).toBeDefined();

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
		const { client, cookies } = await createAuthenticatedClient();

		const { viewId } = await createSavedView(client, cookies, {
			icon: "star",
			name: "Original Name",
			queryDefinition: {
				sort: { direction: "asc", field: ["name"] },
				entitySchemaSlugs: ["book"],
				filters: [],
			},
			displayConfiguration: {
				layout: "grid",
				table: { columns: [] },
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
			},
		});

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
		const { client, cookies } = await createAuthenticatedClient();

		const builtinView = await findBuiltinView(client, cookies);

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
