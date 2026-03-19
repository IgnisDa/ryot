import { describe, expect, it } from "bun:test";
import {
	buildGridDisplayConfiguration,
	buildGridRequest,
	createCrossSchemaRuntimeFixture,
	createEntity,
	createSingleSchemaRuntimeFixture,
	executeViewRuntime,
} from "../test-support/view-runtime";
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
		expect(firstItem?.resolvedProperties).toEqual({
			badgeProperty: "phone",
			subtitleProperty: 2018,
			titleProperty: "Alpha Phone",
			imageProperty: {
				kind: "remote",
				url: "https://example.com/alpha-phone.png",
			},
		});
		expect(result?.meta.pagination).toEqual({
			total: 5,
			limit: 10,
			offset: 0,
			totalPages: 1,
			currentPage: 1,
			hasNextPage: false,
			hasPreviousPage: false,
		});
	});

	it("supports eq, ne, gt, gte, lt, lte, in, and isNull filters", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const scenarios = [
			{
				filters: [{ op: "eq" as const, field: ["category"], value: "phone" }],
				expected: ["Alpha Phone", "Gamma Phone"],
			},
			{
				filters: [{ op: "ne" as const, field: ["category"], value: "phone" }],
				expected: ["Beta Tablet", "Delta Watch"],
			},
			{
				filters: [{ op: "gt" as const, field: ["year"], value: 2019 }],
				expected: ["Delta Watch", "Gamma Phone"],
			},
			{
				filters: [{ op: "gte" as const, field: ["year"], value: 2020 }],
				expected: ["Delta Watch", "Gamma Phone"],
			},
			{
				filters: [{ op: "lt" as const, field: ["year"], value: 2020 }],
				expected: ["Alpha Phone", "Beta Tablet"],
			},
			{
				filters: [{ op: "lte" as const, field: ["year"], value: 2019 }],
				expected: ["Alpha Phone", "Beta Tablet"],
			},
			{
				filters: [
					{
						op: "in" as const,
						field: ["category"],
						value: ["tablet", "wearable"],
					},
				],
				expected: ["Beta Tablet", "Delta Watch"],
			},
			{
				filters: [{ op: "isNull" as const, field: ["category"] }],
				expected: ["Omega Prototype"],
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
					{ op: "eq", field: ["category"], value: "phone" },
					{ op: "gte", field: ["year"], value: 2020 },
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
						field: ["@name"],
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
					{ op: "gte", field: [`${smartphoneSlug}.year`], value: 2020 },
					{ op: "gte", field: [`${tabletSlug}.releaseYear`], value: 2021 },
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
				sort: { field: ["@name"], direction: "desc" },
			}),
		);
		const yearResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				sort: { field: ["year"], direction: "asc" },
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
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				sort: {
					field: [`${smartphoneSlug}.year`, `${tabletSlug}.releaseYear`],
					direction: "asc",
				},
				displayConfiguration: neutralDisplay,
			}),
		);

		await createEntity({
			client,
			cookies,
			name: "Null Tablet",
			properties: { maker: "Ghost", releaseYear: 2030 },
			entitySchemaId: tabletSchema.schemaId,
		});

		const nullsLastResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				sort: {
					field: [`${smartphoneSlug}.year`, `${tabletSlug}.releaseLabel`],
					direction: "asc",
				},
				displayConfiguration: neutralDisplay,
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
				page: { limit: 2, offset: 0 },
				expectedNames: ["Alpha Phone", "Beta Tablet"],
				expectedMeta: {
					total: 5,
					limit: 2,
					offset: 0,
					totalPages: 3,
					currentPage: 1,
					hasNextPage: true,
					hasPreviousPage: false,
				},
			},
			{
				page: { limit: 2, offset: 2 },
				expectedNames: ["Delta Watch", "Gamma Phone"],
				expectedMeta: {
					total: 5,
					limit: 2,
					offset: 2,
					totalPages: 3,
					currentPage: 2,
					hasNextPage: true,
					hasPreviousPage: true,
				},
			},
			{
				page: { limit: 1, offset: 4 },
				expectedNames: ["Omega Prototype"],
				expectedMeta: {
					total: 5,
					limit: 1,
					offset: 4,
					totalPages: 5,
					currentPage: 5,
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
					page: scenario.page,
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

	it("clamps out-of-range offsets and returns zero-result pagination metadata", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const clampedResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				page: { limit: 2, offset: 100 },
				entitySchemaSlugs: [schema.slug],
			}),
		);
		const emptyResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [{ op: "eq", field: ["category"], value: "console" }],
			}),
		);

		expect(clampedResult.response.status).toBe(200);
		expect(clampedResult.data?.data.items.map((item) => item.name)).toEqual([
			"Gamma Phone",
			"Omega Prototype",
		]);
		expect(clampedResult.data?.data.meta.pagination).toEqual({
			total: 5,
			limit: 2,
			offset: 3,
			totalPages: 3,
			currentPage: 2,
			hasNextPage: false,
			hasPreviousPage: true,
		});

		expect(emptyResult.response.status).toBe(200);
		expect(emptyResult.data?.data.items).toHaveLength(0);
		expect(emptyResult.data?.data.meta.pagination).toEqual({
			total: 0,
			limit: 10,
			offset: 0,
			totalPages: 0,
			currentPage: 1,
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
				sort: { field: [], direction: "asc" },
			}),
		);

		expect(result.response.status).toBe(400);
		expect(result.error?.error?.message).toContain("Sort field is required");
	});

	registerViewRuntimePresentationAndErrorTests();
});
