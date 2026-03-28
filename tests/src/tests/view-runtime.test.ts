import { describe, expect, it } from "bun:test";
import {
	buildGridDisplayConfiguration,
	buildGridRequest,
	createAuthenticatedClient,
	createCrossSchemaRuntimeFixture,
	createEntitySchema,
	createRuntimeEntity,
	createSingleSchemaRuntimeFixture,
	createTracker,
	executeViewRuntime,
} from "../fixtures";
import { registerViewRuntimePresentationAndErrorTests } from "../test-support/view-runtime-suite";

describe("View runtime E2E", () => {
	it("executes a simple single-schema query with the full response shape", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({ entitySchemaSlugs: [schema.slug] }),
		);
		const result = data?.data;
		const firstItem = result?.items[0];

		expect(response.status).toBe(200);
		expect(result?.items).toHaveLength(5);
		expect(firstItem?.id).toBeDefined();
		expect(firstItem?.name).toBe("Alpha Phone");
		expect(firstItem?.entitySchemaId).toBe(schema.schemaId);
		expect(firstItem?.entitySchemaSlug).toBe(schema.slug);
		expect(Number.isNaN(Date.parse(String(firstItem?.createdAt)))).toBe(false);
		expect(Number.isNaN(Date.parse(String(firstItem?.updatedAt)))).toBe(false);
		expect(firstItem?.image).toEqual({
			kind: "remote",
			url: "https://example.com/alpha-phone.png",
		});
		expect(firstItem && "resolvedProperties" in firstItem).toBe(true);
		if (!firstItem || !("resolvedProperties" in firstItem)) {
			throw new Error("Expected grid runtime item");
		}
		expect(firstItem.resolvedProperties).toEqual({
			badgeProperty: { kind: "text", value: "phone" },
			subtitleProperty: { kind: "number", value: 2018 },
			titleProperty: { kind: "text", value: "Alpha Phone" },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://example.com/alpha-phone.png",
				},
			},
		});
		expect(result?.meta.pagination).toEqual({
			page: 1,
			total: 5,
			limit: 10,
			totalPages: 1,
			hasNextPage: false,
			hasPreviousPage: false,
		});
	});

	it("supports eq, ne, gt, gte, lt, lte, in, and isNull filters", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const scenarios = [
			{
				expected: ["Alpha Phone", "Gamma Phone"],
				filters: [
					{
						value: "phone",
						op: "eq" as const,
						field: `${schema.slug}.category`,
					},
				],
			},
			{
				expected: ["Beta Tablet", "Delta Watch"],
				filters: [
					{
						value: "phone",
						op: "ne" as const,
						field: `${schema.slug}.category`,
					},
				],
			},
			{
				expected: ["Delta Watch", "Gamma Phone"],
				filters: [
					{ op: "gt" as const, field: `${schema.slug}.year`, value: 2019 },
				],
			},
			{
				expected: ["Delta Watch", "Gamma Phone"],
				filters: [
					{ op: "gte" as const, field: `${schema.slug}.year`, value: 2020 },
				],
			},
			{
				expected: ["Alpha Phone", "Beta Tablet"],
				filters: [
					{ op: "lt" as const, field: `${schema.slug}.year`, value: 2020 },
				],
			},
			{
				expected: ["Alpha Phone", "Beta Tablet"],
				filters: [
					{ op: "lte" as const, field: `${schema.slug}.year`, value: 2019 },
				],
			},
			{
				expected: ["Beta Tablet", "Delta Watch"],
				filters: [
					{
						op: "in" as const,
						value: ["tablet", "wearable"],
						field: `${schema.slug}.category`,
					},
				],
			},
			{
				expected: ["Omega Prototype"],
				filters: [{ op: "isNull" as const, field: `${schema.slug}.category` }],
			},
		];

		for (const scenario of scenarios) {
			const { data, response } = await executeViewRuntime(
				client,
				cookies,
				buildGridRequest({
					filters: scenario.filters,
					entitySchemaSlugs: [schema.slug],
				}),
			);

			expect(response.status).toBe(200);
			expect(data?.data.items.map((item) => item.name)).toEqual(
				scenario.expected,
			);
		}
	});

	it("ands multiple filters within a single schema", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [
					{ op: "gte", field: `${schema.slug}.year`, value: 2020 },
					{ op: "eq", field: `${schema.slug}.category`, value: "phone" },
				],
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual(["Gamma Phone"]);
	});

	it("applies top-level name filters across every schema", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createCrossSchemaRuntimeFixture();
		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				filters: [
					{
						op: "in",
						field: "@name",
						value: ["Alpha Phone", "Delta Tablet"],
					},
				],
				displayConfiguration: buildGridDisplayConfiguration({
					badgeProperty: null,
					subtitleProperty: null,
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Alpha Phone",
			"Delta Tablet",
		]);
	});

	it("ors schema-qualified filters across different schemas", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createCrossSchemaRuntimeFixture();
		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				filters: [
					{ op: "gte", field: `${smartphoneSlug}.year`, value: 2020 },
					{ op: "gte", field: `${tabletSlug}.releaseYear`, value: 2021 },
				],
				displayConfiguration: buildGridDisplayConfiguration({
					badgeProperty: null,
					subtitleProperty: null,
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Delta Tablet",
			"Gamma Phone",
			"Omega Phone",
		]);
	});

	it("sorts by name in both directions and by schema properties", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const ascResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({ entitySchemaSlugs: [schema.slug] }),
		);
		const descResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				sort: { fields: ["@name"], direction: "desc" },
			}),
		);
		const yearResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				sort: { fields: [`${schema.slug}.year`], direction: "asc" },
			}),
		);

		expect(ascResult.data?.data.items.map((item) => item.name)).toEqual([
			"Alpha Phone",
			"Beta Tablet",
			"Delta Watch",
			"Gamma Phone",
			"Omega Prototype",
		]);
		expect(descResult.data?.data.items.map((item) => item.name)).toEqual([
			"Omega Prototype",
			"Gamma Phone",
			"Delta Watch",
			"Beta Tablet",
			"Alpha Phone",
		]);
		expect(yearResult.data?.data.items.map((item) => item.name)).toEqual([
			"Alpha Phone",
			"Beta Tablet",
			"Gamma Phone",
			"Delta Watch",
			"Omega Prototype",
		]);
	});

	it("sorts across schemas with COALESCE and keeps null values last", async () => {
		const { client, cookies, smartphoneSlug, tabletSchema, tabletSlug } =
			await createCrossSchemaRuntimeFixture();
		const neutralDisplay = buildGridDisplayConfiguration({
			badgeProperty: null,
			subtitleProperty: null,
		});
		const coalesceResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				displayConfiguration: neutralDisplay,
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				sort: {
					direction: "asc",
					fields: [`${smartphoneSlug}.year`, `${tabletSlug}.releaseYear`],
				},
			}),
		);

		await createRuntimeEntity({
			client,
			cookies,
			name: "Null Tablet",
			entitySchemaId: tabletSchema.schemaId,
			properties: { maker: "Ghost", releaseYear: 2030 },
		});

		const nullsLastResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				displayConfiguration: neutralDisplay,
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				sort: {
					direction: "asc",
					fields: [`${smartphoneSlug}.year`, `${tabletSlug}.releaseLabel`],
				},
			}),
		);

		expect(coalesceResult.response.status).toBe(200);
		expect(coalesceResult.data?.data.items.map((item) => item.name)).toEqual([
			"Alpha Phone",
			"Beta Tablet",
			"Gamma Phone",
			"Delta Tablet",
			"Omega Phone",
		]);
		expect(nullsLastResult.response.status).toBe(200);
		expect(nullsLastResult.data?.data.items.at(-1)?.name).toBe("Null Tablet");
	});

	it("returns correct pagination metadata for first, middle, and last pages", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const scenarios = [
			{
				pagination: { page: 1, limit: 2 },
				expectedNames: ["Alpha Phone", "Beta Tablet"],
				expectedMeta: {
					page: 1,
					total: 5,
					limit: 2,
					totalPages: 3,
					hasNextPage: true,
					hasPreviousPage: false,
				},
			},
			{
				pagination: { page: 2, limit: 2 },
				expectedNames: ["Delta Watch", "Gamma Phone"],
				expectedMeta: {
					page: 2,
					total: 5,
					limit: 2,
					totalPages: 3,
					hasNextPage: true,
					hasPreviousPage: true,
				},
			},
			{
				pagination: { page: 5, limit: 1 },
				expectedNames: ["Omega Prototype"],
				expectedMeta: {
					page: 5,
					total: 5,
					limit: 1,
					totalPages: 5,
					hasNextPage: false,
					hasPreviousPage: true,
				},
			},
		];

		for (const scenario of scenarios) {
			const { data, response } = await executeViewRuntime(
				client,
				cookies,
				buildGridRequest({
					pagination: scenario.pagination,
					entitySchemaSlugs: [schema.slug],
				}),
			);

			expect(response.status).toBe(200);
			expect(data?.data.items.map((item) => item.name)).toEqual(
				scenario.expectedNames,
			);
			expect(data?.data.meta.pagination).toEqual(scenario.expectedMeta);
		}
	});

	it("returns empty out-of-range pages and zero-result pagination metadata", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const emptyPageResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 100, limit: 2 },
			}),
		);
		const emptyResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [
					{ op: "eq", field: `${schema.slug}.category`, value: "console" },
				],
			}),
		);

		expect(emptyPageResult.response.status).toBe(200);
		expect(emptyPageResult.data?.data.items).toEqual([]);
		expect(emptyPageResult.data?.data.meta.pagination).toEqual({
			total: 5,
			limit: 2,
			page: 100,
			totalPages: 3,
			hasNextPage: false,
			hasPreviousPage: true,
		});

		expect(emptyResult.response.status).toBe(200);
		expect(emptyResult.data?.data.items).toHaveLength(0);
		expect(emptyResult.data?.data.meta.pagination).toEqual({
			page: 1,
			total: 0,
			limit: 10,
			totalPages: 0,
			hasNextPage: false,
			hasPreviousPage: false,
		});
	});

	it("keeps empty pages aligned with filtered totals in the single-query path", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const outOfRangeFilteredResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 2, limit: 5 },
				filters: [
					{ op: "eq", field: `${schema.slug}.category`, value: "phone" },
				],
			}),
		);
		const zeroResultsLaterPage = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 3, limit: 2 },
				filters: [
					{ op: "eq", field: `${schema.slug}.category`, value: "console" },
				],
			}),
		);

		expect(outOfRangeFilteredResult.response.status).toBe(200);
		expect(outOfRangeFilteredResult.data?.data.items).toEqual([]);
		expect(outOfRangeFilteredResult.data?.data.meta.pagination).toEqual({
			page: 2,
			total: 2,
			limit: 5,
			totalPages: 1,
			hasNextPage: false,
			hasPreviousPage: true,
		});

		expect(zeroResultsLaterPage.response.status).toBe(200);
		expect(zeroResultsLaterPage.data?.data.items).toEqual([]);
		expect(zeroResultsLaterPage.data?.data.meta.pagination).toEqual({
			page: 3,
			total: 0,
			limit: 2,
			totalPages: 0,
			hasNextPage: false,
			hasPreviousPage: false,
		});
	});

	it("rejects empty runtime sort fields at payload validation time", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const result = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				sort: { fields: [], direction: "asc" },
			}),
		);

		expect(result.response.status).toBe(400);
		expect(result.error?.error?.message).toContain("Sort fields are required");
	});

	it("filters with contains using ilike on string properties and @name", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();

		const nameResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [{ op: "contains", field: "@name", value: "Phone" }],
			}),
		);
		const categoryResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [
					{ op: "contains", value: "phone", field: `${schema.slug}.category` },
				],
			}),
		);

		expect(nameResult.response.status).toBe(200);
		expect(nameResult.data?.data.items.map((item) => item.name)).toEqual([
			"Alpha Phone",
			"Gamma Phone",
		]);

		expect(categoryResult.response.status).toBe(200);
		expect(categoryResult.data?.data.items.map((item) => item.name)).toEqual([
			"Alpha Phone",
			"Gamma Phone",
		]);
	});

	it("filters with contains using jsonb containment for array properties", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Tag Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Movie",
			propertiesSchema: {
				fields: {
					tags: { type: "array", items: { type: "string" } },
				},
			},
		});

		await createRuntimeEntity({
			client,
			cookies,
			image: null,
			name: "Sci-Fi Movie",
			entitySchemaId: schema.schemaId,
			properties: { tags: ["sci-fi", "action"] },
		});
		await createRuntimeEntity({
			client,
			cookies,
			image: null,
			name: "Drama Movie",
			entitySchemaId: schema.schemaId,
			properties: { tags: ["drama"] },
		});
		await createRuntimeEntity({
			client,
			cookies,
			image: null,
			name: "Action Movie",
			entitySchemaId: schema.schemaId,
			properties: { tags: ["action"] },
		});

		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [
					{ op: "contains", field: `${schema.slug}.tags`, value: "action" },
				],
				displayConfiguration: buildGridDisplayConfiguration({
					badgeProperty: null,
					subtitleProperty: null,
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Action Movie",
			"Sci-Fi Movie",
		]);
	});

	it("treats % and _ as literals in contains filters, not as ilike wildcards", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Metachar Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Product",
			propertiesSchema: { fields: { sku: { type: "string" } } },
		});

		await createRuntimeEntity({
			client,
			cookies,
			image: null,
			name: "Percent Item",
			properties: { sku: "A%B" },
			entitySchemaId: schema.schemaId,
		});
		await createRuntimeEntity({
			client,
			cookies,
			image: null,
			name: "Underscore Item",
			properties: { sku: "A_B" },
			entitySchemaId: schema.schemaId,
		});
		await createRuntimeEntity({
			client,
			cookies,
			image: null,
			name: "Middle Item",
			properties: { sku: "AXB" },
			entitySchemaId: schema.schemaId,
		});

		const neutralDisplay = buildGridDisplayConfiguration({
			badgeProperty: null,
			subtitleProperty: null,
		});

		const percentResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				displayConfiguration: neutralDisplay,
				filters: [
					{ op: "contains", field: `${schema.slug}.sku`, value: "A%B" },
				],
			}),
		);
		const underscoreResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				displayConfiguration: neutralDisplay,
				filters: [
					{ op: "contains", field: `${schema.slug}.sku`, value: "A_B" },
				],
			}),
		);

		expect(percentResult.response.status).toBe(200);
		expect(percentResult.data?.data.items.map((item) => item.name)).toEqual([
			"Percent Item",
		]);

		expect(underscoreResult.response.status).toBe(200);
		expect(underscoreResult.data?.data.items.map((item) => item.name)).toEqual([
			"Underscore Item",
		]);
	});

	it("rejects contains filter on array property when the value is itself an array", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Array Guard Tracker",
		});
		const schema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Tagged Item",
			propertiesSchema: {
				fields: {
					tags: { type: "array", items: { type: "string" } },
				},
			},
		});

		const result = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				displayConfiguration: buildGridDisplayConfiguration({
					badgeProperty: null,
					subtitleProperty: null,
				}),
				filters: [
					{
						op: "contains",
						value: ["sci-fi", "action"],
						field: `${schema.slug}.tags`,
					},
				],
			}),
		);

		expect(result.response.status).toBe(400);
		expect(result.error?.error?.message).toContain("requires a scalar value");
	});

	registerViewRuntimePresentationAndErrorTests();
});
