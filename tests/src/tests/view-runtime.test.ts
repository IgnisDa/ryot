import { describe, expect, it } from "bun:test";
import type { paths } from "@ryot/generated/openapi/app-backend";
import type createClient from "openapi-fetch";
import { createAuthenticatedClient } from "../helpers";

type Client = ReturnType<typeof createClient<paths>>;

async function createTracker(client: Client, cookies: string, name: string) {
	const { data } = await client.POST("/trackers", {
		headers: { Cookie: cookies },
		body: {
			name,
			enabled: true,
			icon: "rocket",
			accentColor: "#FF5733",
			description: `${name} description`,
			slug: `tracker-${Date.now()}-${crypto.randomUUID()}`,
		},
	});

	const trackerId = data?.data?.id;
	if (!trackerId) {
		throw new Error("Failed to create tracker");
	}
	return trackerId;
}

async function createEntitySchema(
	client: Client,
	cookies: string,
	trackerId: string,
) {
	const slug = `view-runtime-${Date.now()}-${crypto.randomUUID()}`;
	const { data } = await client.POST("/entity-schemas", {
		headers: { Cookie: cookies },
		body: {
			slug,
			trackerId,
			name: "Device",
			icon: "smartphone",
			accentColor: "#00AA88",
			propertiesSchema: {
				year: { type: "integer" },
				category: { type: "string" },
			},
		},
	});

	const schemaId = data?.data?.id;
	if (!schemaId) {
		throw new Error("Failed to create entity schema");
	}

	return { schemaId, slug };
}

async function createEntity(input: {
	name: string;
	year: number;
	client: Client;
	cookies: string;
	category: string;
	entitySchemaId: string;
	image?: { kind: "remote"; url: string };
}) {
	const { data } = await input.client.POST("/entities", {
		headers: { Cookie: input.cookies },
		body: {
			name: input.name,
			entitySchemaId: input.entitySchemaId,
			properties: { year: input.year, category: input.category },
			image:
				input.image ??
				({
					kind: "remote",
					url: `https://example.com/${input.name.toLowerCase().replace(/\s+/g, "-")}.png`,
				} as const),
		},
	});

	const entityId = data?.data?.id;
	if (!entityId) {
		throw new Error("Failed to create entity");
	}
	return entityId;
}

async function createRuntimeFixture() {
	const { client, cookies } = await createAuthenticatedClient();
	const trackerId = await createTracker(client, cookies, "Device Tracker");
	const { schemaId, slug } = await createEntitySchema(
		client,
		cookies,
		trackerId,
	);

	await createEntity({
		client,
		cookies,
		year: 2021,
		category: "phone",
		name: "Gamma Phone",
		entitySchemaId: schemaId,
	});
	await createEntity({
		client,
		cookies,
		year: 2019,
		category: "phone",
		name: "Alpha Phone",
		entitySchemaId: schemaId,
	});
	await createEntity({
		client,
		cookies,
		year: 2020,
		category: "tablet",
		name: "Beta Tablet",
		entitySchemaId: schemaId,
	});

	return { client, cookies, slug };
}

describe("POST /view-runtime/execute", () => {
	it("returns entities for a simple single-schema query", async () => {
		const { client, cookies, slug } = await createRuntimeFixture();

		const { data, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "grid",
				entitySchemaSlugs: [slug],
				page: { limit: 10, offset: 0 },
				sort: { direction: "asc", field: ["@name"] },
				displayConfiguration: {
					titleProperty: ["@name"],
					imageProperty: ["@image"],
					subtitleProperty: ["year"],
					badgeProperty: ["category"],
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.items).toHaveLength(3);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Alpha Phone",
			"Beta Tablet",
			"Gamma Phone",
		]);
		expect(data?.data.items[0]?.entitySchemaSlug).toBe(slug);
	});

	it("returns pagination metadata for the requested page", async () => {
		const { client, cookies, slug } = await createRuntimeFixture();

		const { data, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "grid",
				entitySchemaSlugs: [slug],
				page: { limit: 2, offset: 0 },
				sort: { direction: "asc", field: ["@name"] },
				displayConfiguration: {
					titleProperty: ["@name"],
					imageProperty: ["@image"],
					subtitleProperty: ["year"],
					badgeProperty: ["category"],
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.items).toHaveLength(2);
		expect(data?.data.meta.pagination).toEqual({
			total: 3,
			limit: 2,
			offset: 0,
			totalPages: 2,
			currentPage: 1,
			hasNextPage: true,
			hasPreviousPage: false,
		});
	});

	it("clamps offsets beyond the final page", async () => {
		const { client, cookies, slug } = await createRuntimeFixture();

		const { data, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "grid",
				entitySchemaSlugs: [slug],
				page: { limit: 2, offset: 100 },
				sort: { direction: "asc", field: ["@name"] },
				displayConfiguration: {
					titleProperty: ["@name"],
					imageProperty: ["@image"],
					subtitleProperty: ["year"],
					badgeProperty: ["category"],
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.items).toHaveLength(2);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Beta Tablet",
			"Gamma Phone",
		]);
		expect(data?.data.meta.pagination).toEqual({
			total: 3,
			limit: 2,
			offset: 1,
			totalPages: 2,
			currentPage: 1,
			hasNextPage: false,
			hasPreviousPage: true,
		});
	});

	it("returns zero-page pagination metadata for empty results", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const trackerId = await createTracker(
			client,
			cookies,
			"Empty Device Tracker",
		);
		const { slug } = await createEntitySchema(client, cookies, trackerId);

		const { data, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "grid",
				entitySchemaSlugs: [slug],
				page: { limit: 10, offset: 0 },
				sort: { direction: "asc", field: ["year"] },
				displayConfiguration: {
					titleProperty: ["@name"],
					imageProperty: ["@image"],
					subtitleProperty: ["year"],
					badgeProperty: ["category"],
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.items).toHaveLength(0);
		expect(data?.data.meta.pagination).toEqual({
			total: 0,
			limit: 10,
			offset: 0,
			totalPages: 0,
			currentPage: 1,
			hasNextPage: false,
			hasPreviousPage: false,
		});
	});

	it("sorts by @name alphabetically", async () => {
		const { client, cookies, slug } = await createRuntimeFixture();

		const { data } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "grid",
				entitySchemaSlugs: [slug],
				page: { limit: 10, offset: 0 },
				sort: { direction: "asc", field: ["@name"] },
				displayConfiguration: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					subtitleProperty: ["year"],
					badgeProperty: ["category"],
				},
			},
		});

		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Alpha Phone",
			"Beta Tablet",
			"Gamma Phone",
		]);
	});

	it("sorts by schema property values", async () => {
		const { client, cookies, slug } = await createRuntimeFixture();

		const { data, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "grid",
				entitySchemaSlugs: [slug],
				page: { limit: 10, offset: 0 },
				sort: { direction: "asc", field: ["year"] },
				displayConfiguration: {
					titleProperty: ["@name"],
					imageProperty: ["@image"],
					subtitleProperty: ["year"],
					badgeProperty: ["category"],
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Alpha Phone",
			"Beta Tablet",
			"Gamma Phone",
		]);
	});

	it("resolves semantic grid and list properties and keeps image unions raw", async () => {
		const { client, cookies, slug } = await createRuntimeFixture();

		const { data: gridData } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "grid",
				entitySchemaSlugs: [slug],
				page: { limit: 1, offset: 0 },
				sort: { direction: "asc", field: ["@name"] },
				displayConfiguration: {
					titleProperty: ["@name"],
					imageProperty: ["@image"],
					subtitleProperty: ["year"],
					badgeProperty: ["category"],
				},
			},
		});

		const { data: listData } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "list",
				entitySchemaSlugs: [slug],
				page: { limit: 1, offset: 0 },
				sort: { direction: "asc", field: ["@name"] },
				displayConfiguration: {
					titleProperty: ["@name"],
					imageProperty: ["@image"],
					subtitleProperty: ["year"],
					badgeProperty: ["category"],
				},
			},
		});

		const gridItem = gridData?.data.items[0];
		const listItem = listData?.data.items[0];

		expect(gridItem?.resolvedProperties).toEqual({
			subtitleProperty: 2019,
			badgeProperty: "phone",
			titleProperty: "Alpha Phone",
			imageProperty: {
				kind: "remote",
				url: "https://example.com/alpha-phone.png",
			},
		});
		expect(listItem?.resolvedProperties).toEqual(gridItem?.resolvedProperties);
		expect(gridItem?.image).toEqual({
			kind: "remote",
			url: "https://example.com/alpha-phone.png",
		});
	});

	it("returns 404 for a non-existent schema slug", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { error, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "grid",
				page: { limit: 10, offset: 0 },
				entitySchemaSlugs: ["missing-schema"],
				sort: { direction: "asc", field: ["@name"] },
				displayConfiguration: {
					titleProperty: ["@name"],
					imageProperty: ["@image"],
					subtitleProperty: ["year"],
					badgeProperty: ["category"],
				},
			},
		});

		expect(response.status).toBe(404);
		expect(error?.error?.message).toBe("Schema 'missing-schema' not found");
	});

	it("returns 400 when sort.field is empty", async () => {
		const { client, cookies, slug } = await createRuntimeFixture();

		const { error, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "grid",
				entitySchemaSlugs: [slug],
				page: { limit: 10, offset: 0 },
				sort: { direction: "asc", field: [] },
				displayConfiguration: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					subtitleProperty: ["year"],
					badgeProperty: ["category"],
				},
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error?.message).toBe("Sort field is required");
	});

	it("returns 400 for invalid display property references", async () => {
		const { client, cookies, slug } = await createRuntimeFixture();

		const { error, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "grid",
				entitySchemaSlugs: [slug],
				page: { limit: 10, offset: 0 },
				sort: { direction: "asc", field: ["@name"] },
				displayConfiguration: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					subtitleProperty: ["missingProperty"],
					badgeProperty: ["category"],
				},
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error?.message).toBe(
			`Property 'missingProperty' not found in schema '${slug}'`,
		);
	});

	it("returns 400 when filters are provided before Task 07", async () => {
		const { client, cookies, slug } = await createRuntimeFixture();

		const { error, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				layout: "grid",
				entitySchemaSlugs: [slug],
				page: { limit: 10, offset: 0 },
				sort: { direction: "asc", field: ["@name"] },
				filters: [{ op: "eq", field: ["category"], value: "phone" }],
				displayConfiguration: {
					titleProperty: ["@name"],
					imageProperty: ["@image"],
					subtitleProperty: ["year"],
					badgeProperty: ["category"],
				},
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error?.message).toBe(
			"Filters are not supported for single-schema execution yet",
		);
	});
});
