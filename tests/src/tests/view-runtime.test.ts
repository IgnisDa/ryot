import { describe, expect, it } from "bun:test";
import type { paths } from "@ryot/generated/openapi/app-backend";
import type createClient from "openapi-fetch";
import { createAuthenticatedClient } from "../helpers";

type Client = ReturnType<typeof createClient<paths>>;

type TestPropertiesSchema = Record<
	string,
	{ type: "integer" | "number" | "string" }
>;

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
	options?: {
		name?: string;
		slug?: string;
		icon?: string;
		propertiesSchema?: TestPropertiesSchema;
	},
) {
	const slug =
		options?.slug ?? `view-runtime-${Date.now()}-${crypto.randomUUID()}`;
	const { data } = await client.POST("/entity-schemas", {
		headers: { Cookie: cookies },
		body: {
			slug,
			trackerId,
			accentColor: "#00AA88",
			name: options?.name ?? "Device",
			icon: options?.icon ?? "smartphone",
			propertiesSchema: options?.propertiesSchema ?? {
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
	client: Client;
	cookies: string;
	entitySchemaId: string;
	properties: Record<string, unknown>;
	image?: { kind: "remote"; url: string };
}) {
	const { data } = await input.client.POST("/entities", {
		headers: { Cookie: input.cookies },
		body: {
			name: input.name,
			properties: input.properties,
			entitySchemaId: input.entitySchemaId,
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
		name: "Gamma Phone",
		entitySchemaId: schemaId,
		properties: { year: 2021, category: "phone" },
	});
	await createEntity({
		client,
		cookies,
		name: "Alpha Phone",
		entitySchemaId: schemaId,
		properties: { year: 2019, category: "phone" },
	});
	await createEntity({
		client,
		cookies,
		name: "Beta Tablet",
		entitySchemaId: schemaId,
		properties: { year: 2020, category: "tablet" },
	});

	return { client, cookies, slug };
}

async function createCrossSchemaRuntimeFixture() {
	const { client, cookies } = await createAuthenticatedClient();
	const trackerId = await createTracker(
		client,
		cookies,
		"Mixed Device Tracker",
	);
	const smartphoneSchema = await createEntitySchema(
		client,
		cookies,
		trackerId,
		{
			name: "Smartphone",
			slug: `smartphones-${crypto.randomUUID()}`,
			propertiesSchema: {
				year: { type: "integer" },
				category: { type: "string" },
				manufacturer: { type: "string" },
			},
		},
	);
	const tabletSchema = await createEntitySchema(client, cookies, trackerId, {
		name: "Tablet",
		icon: "tablet",
		slug: `tablets-${crypto.randomUUID()}`,
		propertiesSchema: {
			manufacturer: { type: "string" },
			maker: { type: "string" },
			category: { type: "string" },
			releaseLabel: { type: "string" },
			releaseYear: { type: "integer" },
		},
	});

	await createEntity({
		client,
		cookies,
		name: "Alpha Phone",
		entitySchemaId: smartphoneSchema.schemaId,
		properties: { year: 2019, category: "phone", manufacturer: "Acme" },
	});
	await createEntity({
		client,
		cookies,
		name: "Gamma Phone",
		entitySchemaId: smartphoneSchema.schemaId,
		properties: { year: 2021, category: "phone", manufacturer: "Zenith" },
	});
	await createEntity({
		client,
		cookies,
		name: "Omega Phone",
		properties: { year: 2024, manufacturer: "Nova" },
		entitySchemaId: smartphoneSchema.schemaId,
	});
	await createEntity({
		client,
		cookies,
		name: "Beta Tablet",
		entitySchemaId: tabletSchema.schemaId,
		properties: {
			manufacturer: "LegacyCo",
			maker: "Tabula",
			releaseYear: 2020,
			category: "tablet",
			releaseLabel: "2020",
		},
	});
	await createEntity({
		client,
		cookies,
		name: "Delta Tablet",
		entitySchemaId: tabletSchema.schemaId,
		properties: {
			manufacturer: "Archive Devices",
			maker: "Slate",
			releaseYear: 2022,
			category: "tablet",
			releaseLabel: "2022",
		},
	});

	return {
		client,
		cookies,
		tabletSchema,
		smartphoneSchema,
		tabletSlug: tabletSchema.slug,
		smartphoneSlug: smartphoneSchema.slug,
	};
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

	it("filters a single schema by exact property matches", async () => {
		const { client, cookies, slug } = await createRuntimeFixture();

		const { data, response } = await client.POST("/view-runtime/execute", {
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

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Alpha Phone",
			"Gamma Phone",
		]);
	});

	it("ands multiple filters within a schema", async () => {
		const { client, cookies, slug } = await createRuntimeFixture();

		const { data, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				layout: "grid",
				entitySchemaSlugs: [slug],
				page: { limit: 10, offset: 0 },
				sort: { direction: "asc", field: ["@name"] },
				filters: [
					{ op: "eq", field: ["category"], value: "phone" },
					{ op: "gte", field: ["year"], value: 2020 },
				],
				displayConfiguration: {
					titleProperty: ["@name"],
					imageProperty: ["@image"],
					subtitleProperty: ["year"],
					badgeProperty: ["category"],
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual(["Gamma Phone"]);
	});

	it("applies top-level filters across every schema", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createCrossSchemaRuntimeFixture();

		const { data, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				layout: "grid",
				page: { limit: 10, offset: 0 },
				sort: { direction: "asc", field: ["@name"] },
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				filters: [
					{
						op: "in",
						field: ["@name"],
						value: ["Alpha Phone", "Delta Tablet"],
					},
				],
				displayConfiguration: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
					imageProperty: ["@image"],
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Alpha Phone",
			"Delta Tablet",
		]);
	});

	it("ors schema-qualified filters across different schemas", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createCrossSchemaRuntimeFixture();

		const { data, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				layout: "grid",
				page: { limit: 10, offset: 0 },
				sort: { direction: "asc", field: ["@name"] },
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				filters: [
					{ op: "gte", field: [`${smartphoneSlug}.year`], value: 2020 },
					{ op: "gte", field: [`${tabletSlug}.releaseYear`], value: 2021 },
				],
				displayConfiguration: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
					imageProperty: ["@image"],
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Delta Tablet",
			"Gamma Phone",
			"Omega Phone",
		]);
	});

	it("supports isNull filters for missing properties", async () => {
		const { client, cookies, smartphoneSlug } =
			await createCrossSchemaRuntimeFixture();

		const { data, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				layout: "grid",
				page: { limit: 10, offset: 0 },
				entitySchemaSlugs: [smartphoneSlug],
				sort: { direction: "asc", field: ["@name"] },
				filters: [{ op: "isNull", field: ["category"] }],
				displayConfiguration: {
					titleProperty: ["@name"],
					imageProperty: ["@image"],
					subtitleProperty: ["year"],
					badgeProperty: ["category"],
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual(["Omega Phone"]);
	});

	it("sorts across schemas when sort fields resolve to different property types", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createCrossSchemaRuntimeFixture();

		const { data, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "grid",
				page: { limit: 10, offset: 0 },
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				sort: {
					direction: "asc",
					field: [`${smartphoneSlug}.year`, `${tabletSlug}.releaseLabel`],
				},
				displayConfiguration: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
					imageProperty: ["@image"],
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Alpha Phone",
			"Beta Tablet",
			"Gamma Phone",
			"Delta Tablet",
			"Omega Phone",
		]);
	});

	it("keeps numeric ordering when cross-schema sort fields mix integers and numbers", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const trackerId = await createTracker(
			client,
			cookies,
			"Numeric Sort Tracker",
		);
		const smartphoneSchema = await createEntitySchema(
			client,
			cookies,
			trackerId,
			{
				name: "Numeric Phone",
				slug: `numeric-phones-${crypto.randomUUID()}`,
				propertiesSchema: { year: { type: "integer" } },
			},
		);
		const tabletSchema = await createEntitySchema(client, cookies, trackerId, {
			name: "Numeric Tablet",
			slug: `numeric-tablets-${crypto.randomUUID()}`,
			propertiesSchema: { score: { type: "number" } },
		});

		await createEntity({
			client,
			cookies,
			name: "Phone Two",
			entitySchemaId: smartphoneSchema.schemaId,
			properties: { year: 2 },
		});
		await createEntity({
			client,
			cookies,
			name: "Tablet Three Point Five",
			entitySchemaId: tabletSchema.schemaId,
			properties: { score: 3.5 },
		});
		await createEntity({
			client,
			cookies,
			name: "Tablet Ten",
			entitySchemaId: tabletSchema.schemaId,
			properties: { score: 10 },
		});

		const { data, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "grid",
				page: { limit: 10, offset: 0 },
				entitySchemaSlugs: [smartphoneSchema.slug, tabletSchema.slug],
				sort: {
					direction: "asc",
					field: [
						`${smartphoneSchema.slug}.year`,
						`${tabletSchema.slug}.score`,
					],
				},
				displayConfiguration: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
					imageProperty: ["@image"],
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Phone Two",
			"Tablet Three Point Five",
			"Tablet Ten",
		]);
	});

	it("coalesces cross-schema display properties for grid layouts", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createCrossSchemaRuntimeFixture();

		const { data, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "grid",
				page: { limit: 5, offset: 0 },
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				sort: {
					direction: "asc",
					field: [`${smartphoneSlug}.year`, `${tabletSlug}.releaseYear`],
				},
				displayConfiguration: {
					titleProperty: ["@name"],
					imageProperty: ["@image"],
					subtitleProperty: [
						`${smartphoneSlug}.manufacturer`,
						`${tabletSlug}.maker`,
					],
					badgeProperty: [
						`${smartphoneSlug}.year`,
						`${tabletSlug}.releaseYear`,
					],
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.resolvedProperties).toEqual({
			badgeProperty: 2019,
			subtitleProperty: "Acme",
			titleProperty: "Alpha Phone",
			imageProperty: {
				kind: "remote",
				url: "https://example.com/alpha-phone.png",
			},
		});
		expect(data?.data.items[1]?.resolvedProperties).toEqual({
			badgeProperty: 2020,
			subtitleProperty: "Tabula",
			titleProperty: "Beta Tablet",
			imageProperty: {
				kind: "remote",
				url: "https://example.com/beta-tablet.png",
			},
		});
	});

	it("places entities with missing cross-schema sort values last", async () => {
		const { client, cookies, smartphoneSlug, tabletSchema, tabletSlug } =
			await createCrossSchemaRuntimeFixture();

		await createEntity({
			client,
			cookies,
			name: "Null Tablet",
			entitySchemaId: tabletSchema.schemaId,
			properties: { maker: "Ghost", releaseYear: 2030 },
		});

		const { data, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "grid",
				page: { limit: 10, offset: 0 },
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				sort: {
					direction: "asc",
					field: [`${smartphoneSlug}.year`, `${tabletSlug}.releaseLabel`],
				},
				displayConfiguration: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
					imageProperty: ["@image"],
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.items.at(-1)?.name).toBe("Null Tablet");
	});

	it("returns table columns with index-based keys and nulls for empty references", async () => {
		const { client, cookies, slug } = await createRuntimeFixture();

		const { data, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				filters: [],
				layout: "table",
				entitySchemaSlugs: [slug],
				page: { limit: 1, offset: 0 },
				sort: { direction: "asc", field: ["year"] },
				displayConfiguration: {
					columns: [
						{ property: ["@name"] },
						{ property: ["year"] },
						{ property: [] },
					],
				},
			},
		});

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.resolvedProperties).toEqual({
			column_1: 2019,
			column_2: null,
			column_0: "Alpha Phone",
		});
	});

	it("returns 400 for missing filter properties", async () => {
		const { client, cookies, slug } = await createRuntimeFixture();

		const { error, response } = await client.POST("/view-runtime/execute", {
			headers: { Cookie: cookies },
			body: {
				layout: "grid",
				entitySchemaSlugs: [slug],
				page: { limit: 10, offset: 0 },
				sort: { direction: "asc", field: ["@name"] },
				filters: [{ op: "eq", field: ["missingProperty"], value: "phone" }],
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
			`Property 'missingProperty' not found in schema '${slug}'`,
		);
	});
});
