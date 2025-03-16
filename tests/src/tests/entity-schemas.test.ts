import { describe, expect, it } from "bun:test";
import type { paths } from "@ryot/generated/openapi/app-backend";
import type createClient from "openapi-fetch";
import { createAuthenticatedClient } from "../helpers";

type Client = ReturnType<typeof createClient<paths>>;

interface CreateTrackerOptions {
	icon?: string;
	name?: string;
	slug?: string;
	enabled?: boolean;
	accentColor?: string;
	description?: string;
}

async function createTracker(
	client: Client,
	cookies: string,
	options: CreateTrackerOptions = {},
) {
	const {
		enabled = true,
		icon = "rocket",
		name = "Test Tracker",
		accentColor = "#FF5733",
		slug = `tracker-${Date.now()}`,
		description = "Test tracker description",
	} = options;

	const { data } = await client.POST("/trackers", {
		headers: { Cookie: cookies },
		body: { icon, name, slug, enabled, accentColor, description },
	});

	const trackerId = data?.data?.id;
	if (!trackerId) {
		throw new Error("Failed to create tracker");
	}

	return { trackerId, data: data.data };
}

interface CreateEntitySchemaOptions {
	icon?: string;
	name?: string;
	slug?: string;
	trackerId: string;
	accentColor?: string;
	propertiesSchema?: {
		[key: string]: {
			type: "string" | "number" | "integer" | "boolean" | "date";
		};
	};
}

async function createEntitySchema(
	client: Client,
	cookies: string,
	options: CreateEntitySchemaOptions,
) {
	const {
		trackerId,
		icon = "book",
		name = "Test Schema",
		accentColor = "#00FF00",
		slug = `schema-${Date.now()}`,
		propertiesSchema = { title: { type: "string" } },
	} = options;

	const { data } = await client.POST("/entity-schemas", {
		headers: { Cookie: cookies },
		body: { icon, name, slug, trackerId, accentColor, propertiesSchema },
	});

	const schemaId = data?.data?.id;
	if (!schemaId) {
		throw new Error("Failed to create entity schema");
	}

	return { schemaId, data: data.data };
}

async function findBuiltinTracker(client: Client, cookies: string) {
	const { data: listData } = await client.GET("/trackers", {
		headers: { Cookie: cookies },
	});

	const builtinTracker = listData?.data?.find((t) => t.isBuiltin);
	if (!builtinTracker) {
		throw new Error("Built-in tracker not found");
	}

	return builtinTracker;
}

describe("GET /entity-schemas", () => {
	it("returns 200 and lists built-in entity schemas for built-in tracker", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const builtinTracker = await findBuiltinTracker(client, cookies);

		const { data, response } = await client.GET("/entity-schemas", {
			headers: { Cookie: cookies },
			params: { query: { trackerId: builtinTracker.id } },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(Array.isArray(data?.data)).toBe(true);
		expect(data?.data?.length).toBeGreaterThan(0);

		const firstSchema = data?.data?.[0];
		expect(firstSchema?.id).toBeDefined();
		expect(firstSchema?.name).toBeDefined();
		expect(firstSchema?.slug).toBeDefined();
		expect(firstSchema?.trackerId).toBe(builtinTracker.id);
		expect(firstSchema?.isBuiltin).toBe(true);
		expect(firstSchema?.icon).toBeDefined();
		expect(firstSchema?.accentColor).toBeDefined();
		expect(firstSchema?.propertiesSchema).toBeDefined();
	});

	it("returns 200 and lists custom entity schemas for custom tracker", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, cookies, {
			name: "Custom Tracker",
		});

		const { schemaId } = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Custom Schema",
			slug: "custom-schema",
		});

		const { data, response } = await client.GET("/entity-schemas", {
			headers: { Cookie: cookies },
			params: { query: { trackerId } },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(Array.isArray(data?.data)).toBe(true);
		expect(data?.data?.length).toBe(1);

		const schema = data?.data?.[0];
		expect(schema?.id).toBe(schemaId);
		expect(schema?.name).toBe("Custom Schema");
		expect(schema?.slug).toBe("custom-schema");
		expect(schema?.trackerId).toBe(trackerId);
		expect(schema?.isBuiltin).toBe(false);
	});

	it("returns 404 for non-existent tracker", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const nonExistentId = "00000000-0000-0000-0000-000000000000";
		const { response, error } = await client.GET("/entity-schemas", {
			params: { query: { trackerId: nonExistentId } },
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(404);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe("Tracker not found");
	});

	it("returns empty array for custom tracker with no schemas", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, cookies, {
			name: "Empty Tracker",
		});

		const { data, response } = await client.GET("/entity-schemas", {
			headers: { Cookie: cookies },
			params: { query: { trackerId } },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(Array.isArray(data?.data)).toBe(true);
		expect(data?.data?.length).toBe(0);
	});

	it("returns 404 when attempting to access another user's custom tracker", async () => {
		const { client: client1, cookies: cookies1 } =
			await createAuthenticatedClient();
		const { client: client2, cookies: cookies2 } =
			await createAuthenticatedClient();

		const { trackerId } = await createTracker(client1, cookies1, {
			name: "User 1 Tracker",
		});

		const { response, error } = await client2.GET("/entity-schemas", {
			headers: { Cookie: cookies2 },
			params: { query: { trackerId } },
		});

		expect(response.status).toBe(404);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe("Tracker not found");
	});

	it("lists multiple custom schemas ordered by name and createdAt", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, cookies, {
			name: "Multi Schema Tracker",
		});

		await createEntitySchema(client, cookies, {
			trackerId,
			slug: "zebra",
			name: "Zebra Schema",
		});

		await createEntitySchema(client, cookies, {
			trackerId,
			slug: "alpha",
			name: "Alpha Schema",
		});

		await createEntitySchema(client, cookies, {
			trackerId,
			slug: "beta",
			name: "Beta Schema",
		});

		const { data, response } = await client.GET("/entity-schemas", {
			headers: { Cookie: cookies },
			params: { query: { trackerId } },
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(data?.data?.length).toBe(3);

		const names = data?.data?.map((s) => s.name);
		expect(names).toEqual(["Alpha Schema", "Beta Schema", "Zebra Schema"]);
	});
});

describe("POST /entity-schemas", () => {
	it("returns 400 when attempting to create schema for built-in tracker", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const builtinTracker = await findBuiltinTracker(client, cookies);

		const { response, error } = await client.POST("/entity-schemas", {
			headers: { Cookie: cookies },
			body: {
				icon: "test",
				slug: "hacked",
				name: "Hacked Schema",
				accentColor: "#FF0000",
				trackerId: builtinTracker.id,
				propertiesSchema: { field: { type: "string" } },
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe(
			"Built-in trackers do not support entity schema creation",
		);
	});

	it("successfully creates schema for custom tracker", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, cookies, {
			name: "Custom Tracker",
		});

		const { data, response } = await client.POST("/entity-schemas", {
			headers: { Cookie: cookies },
			body: {
				trackerId,
				icon: "star",
				name: "My Schema",
				slug: "my-schema",
				accentColor: "#00FF00",
				propertiesSchema: {
					year: { type: "number" },
					title: { type: "string" },
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data).toBeDefined();
		expect(data?.data?.name).toBe("My Schema");
		expect(data?.data?.slug).toBe("my-schema");
		expect(data?.data?.trackerId).toBe(trackerId);
		expect(data?.data?.isBuiltin).toBe(false);
	});

	it("returns 404 when tracker does not exist", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const nonExistentId = "00000000-0000-0000-0000-000000000000";
		const { response, error } = await client.POST("/entity-schemas", {
			headers: { Cookie: cookies },
			body: {
				icon: "test",
				name: "Schema",
				slug: "schema",
				accentColor: "#FF0000",
				trackerId: nonExistentId,
				propertiesSchema: { field: { type: "string" } },
			},
		});

		expect(response.status).toBe(404);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe("Tracker not found");
	});

	it("returns 404 when attempting to create schema for another user's tracker", async () => {
		const { client: client1, cookies: cookies1 } =
			await createAuthenticatedClient();
		const { client: client2, cookies: cookies2 } =
			await createAuthenticatedClient();

		const { trackerId } = await createTracker(client1, cookies1, {
			name: "User 1 Tracker",
		});

		const { response, error } = await client2.POST("/entity-schemas", {
			headers: { Cookie: cookies2 },
			body: {
				trackerId,
				icon: "test",
				slug: "hacked",
				name: "Hacked Schema",
				accentColor: "#FF0000",
				propertiesSchema: { field: { type: "string" } },
			},
		});

		expect(response.status).toBe(404);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe("Tracker not found");
	});

	it("returns 400 when slug already exists for user", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { trackerId } = await createTracker(client, cookies, {
			name: "Tracker",
		});

		await createEntitySchema(client, cookies, {
			trackerId,
			name: "First Schema",
			slug: "duplicate-slug",
		});

		const { response, error } = await client.POST("/entity-schemas", {
			headers: { Cookie: cookies },
			body: {
				trackerId,
				icon: "test",
				name: "Second Schema",
				slug: "duplicate-slug",
				accentColor: "#FF0000",
				propertiesSchema: { field: { type: "string" } },
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error).toBeDefined();
		expect(error?.error?.message).toBe("Entity schema slug already exists");
	});
});
