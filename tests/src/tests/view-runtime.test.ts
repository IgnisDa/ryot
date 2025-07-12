import { describe, expect, it } from "bun:test";
import {
	buildComputedField,
	buildGridDisplayConfiguration,
	buildGridRequest,
	buildRuntimeField,
	buildTableDisplayConfiguration,
	buildTableRequest,
	createAuthenticatedClient,
	createCrossSchemaRuntimeFixture,
	createEntitySchema,
	createEventSchema,
	createRuntimeEntity,
	createSingleSchemaRuntimeFixture,
	createTracker,
	executeViewRuntime,
} from "../fixtures";
import { registerViewRuntimePresentationAndErrorTests } from "../test-support/view-runtime-suite";

const entityField = (schemaSlug: string, property: string) => {
	if (
		property === "id" ||
		property === "name" ||
		property === "image" ||
		property === "createdAt" ||
		property === "updatedAt"
	) {
		return `entity.${schemaSlug}.@${property}`;
	}

	return `entity.${schemaSlug}.${property}`;
};

const getField = (
	item:
		| NonNullable<
				Awaited<ReturnType<typeof executeViewRuntime>>["data"]
		  >["data"]["items"][number]
		| undefined,
	key: string,
) => {
	const field = item?.fields.find((entry) => entry.key === key);
	expect(field).toBeDefined();
	if (!field) {
		throw new Error(`Expected runtime field '${key}'`);
	}

	return field;
};

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
		expect(getField(firstItem, "badge")).toEqual({
			key: "badge",
			kind: "text",
			value: "phone",
		});
		expect(getField(firstItem, "subtitle")).toEqual({
			key: "subtitle",
			kind: "number",
			value: 2018,
		});
		expect(getField(firstItem, "title")).toEqual({
			key: "title",
			kind: "text",
			value: "Alpha Phone",
		});
		expect(getField(firstItem, "image")).toEqual({
			key: "image",
			kind: "image",
			value: {
				kind: "remote",
				url: "https://example.com/alpha-phone.png",
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

	it("accepts literal and coalesce expressions in raw runtime fields", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const { data, response } = await executeViewRuntime(client, cookies, {
			entitySchemaSlugs: [schema.slug],
			eventJoins: [],
			filters: [],
			pagination: { page: 1, limit: 1 },
			sort: { fields: [entityField(schema.slug, "name")], direction: "asc" },
			fields: [
				buildRuntimeField("label", { type: "literal", value: "Pinned" }),
				buildRuntimeField("yearOrFallback", {
					type: "coalesce",
					values: [
						{ type: "literal", value: null },
						{
							type: "reference",
							reference: {
								type: "schema-property",
								slug: schema.slug,
								property: "year",
							},
						},
						{ type: "literal", value: 0 },
					],
				}),
			],
		});

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.fields).toEqual([
			{ key: "label", kind: "text", value: "Pinned" },
			{ key: "yearOrFallback", kind: "number", value: 2018 },
		]);
	});

	it("reuses computed fields in raw output and preserves null latest-event values", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: { label: { type: "string" }, rating: { type: "number" } },
			},
		});

		const { data, response } = await executeViewRuntime(client, cookies, {
			filters: [],
			entitySchemaSlugs: [schema.slug],
			pagination: { page: 1, limit: 5 },
			sort: { fields: [entityField(schema.slug, "name")], direction: "asc" },
			fields: [
				buildRuntimeField("title", ["computed.entityLabel"]),
				buildRuntimeField("badge", ["computed.reviewOrLabel"]),
				buildRuntimeField("rawReview", ["computed.reviewLabel"]),
			],
			eventJoins: [
				{ key: "review", kind: "latestEvent", eventSchemaSlug: "review" },
			],
			computedFields: [
				buildComputedField("entityLabel", [entityField(schema.slug, "name")]),
				buildComputedField("reviewLabel", ["event.review.label"]),
				buildComputedField("reviewOrLabel", {
					type: "coalesce",
					values: [
						{
							type: "reference",
							reference: { key: "reviewLabel", type: "computed-field" },
						},
						{
							type: "reference",
							reference: { key: "entityLabel", type: "computed-field" },
						},
					],
				}),
			],
		});

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.fields).toEqual([
			{ key: "title", kind: "text", value: "Alpha Phone" },
			{ key: "badge", kind: "text", value: "Alpha Phone" },
			{ key: "rawReview", kind: "null", value: null },
		]);
	});

	it("sorts and filters by computed fields in raw runtime requests", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const yearExpression = {
			type: "reference" as const,
			reference: {
				property: "year",
				slug: schema.slug,
				type: "schema-property" as const,
			},
		};
		const nextYearReference = {
			type: "reference" as const,
			reference: { type: "computed-field" as const, key: "nextYear" },
		};
		const labelReference = {
			type: "reference" as const,
			reference: { type: "computed-field" as const, key: "label" },
		};

		const { data, response } = await executeViewRuntime(client, cookies, {
			eventJoins: [],
			entitySchemaSlugs: [schema.slug],
			pagination: { page: 1, limit: 5 },
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
						left: yearExpression,
						right: { type: "literal", value: 1 },
					},
				},
				{
					key: "label",
					expression: {
						type: "concat",
						values: [{ type: "literal", value: "Release " }, nextYearReference],
					},
				},
			],
			fields: [
				buildRuntimeField("label", labelReference),
				buildRuntimeField("nextYear", nextYearReference),
			],
		} as unknown as Parameters<typeof executeViewRuntime>[2]);

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Delta Watch",
			"Gamma Phone",
		]);
		expect(data?.data.items[0]?.fields).toEqual([
			{ key: "label", kind: "text", value: "Release 2022" },
			{ key: "nextYear", kind: "number", value: 2022 },
		]);
		expect(data?.data.items[1]?.fields).toEqual([
			{ key: "label", kind: "text", value: "Release 2021" },
			{ key: "nextYear", kind: "number", value: 2021 },
		]);
	});

	it("rejects invalid computed field references and cycles in raw runtime requests", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const missingComputedFieldResult = await executeViewRuntime(
			client,
			cookies,
			{
				eventJoins: [],
				computedFields: [],
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 1, limit: 5 },
				sort: {
					direction: "asc",
					expression: {
						type: "reference",
						reference: {
							column: "name",
							slug: schema.slug,
							type: "entity-column",
						},
					},
				},
				filter: null,
				fields: [buildRuntimeField("title", ["computed.missingLabel"])],
			} as unknown as Parameters<typeof executeViewRuntime>[2],
		);
		const cycleResult = await executeViewRuntime(client, cookies, {
			eventJoins: [],
			entitySchemaSlugs: [schema.slug],
			pagination: { page: 1, limit: 5 },
			sort: {
				direction: "asc",
				expression: {
					type: "reference",
					reference: {
						column: "name",
						slug: schema.slug,
						type: "entity-column",
					},
				},
			},
			filter: null,
			computedFields: [
				buildComputedField("first", ["computed.second"]),
				buildComputedField("second", ["computed.first"]),
			],
			fields: [buildRuntimeField("title", ["computed.first"])],
		} as unknown as Parameters<typeof executeViewRuntime>[2]);

		expect(missingComputedFieldResult.response.status).toBe(400);
		expect(missingComputedFieldResult.error?.error?.message).toBe(
			"Computed field 'missingLabel' is not part of this runtime request",
		);
		expect(cycleResult.response.status).toBe(400);
		expect(cycleResult.error?.error?.message).toBe(
			"Computed field dependency cycle detected: first -> second -> first",
		);
	});

	it("rejects invalid computed field types and non-display image usage in raw runtime requests", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const imageSortResult = await executeViewRuntime(client, cookies, {
			filter: null,
			eventJoins: [],
			entitySchemaSlugs: [schema.slug],
			pagination: { page: 1, limit: 5 },
			sort: {
				direction: "asc",
				expression: {
					type: "reference",
					reference: { key: "cover", type: "computed-field" },
				},
			},
			computedFields: [
				{
					key: "cover",
					expression: {
						type: "reference",
						reference: {
							column: "image",
							slug: schema.slug,
							type: "entity-column",
						},
					},
				},
			],
			fields: [buildRuntimeField("image", [entityField(schema.slug, "image")])],
		} as unknown as Parameters<typeof executeViewRuntime>[2]);
		const mismatchedFilterResult = await executeViewRuntime(client, cookies, {
			eventJoins: [],
			entitySchemaSlugs: [schema.slug],
			pagination: { page: 1, limit: 5 },
			sort: {
				direction: "asc",
				expression: {
					type: "reference",
					reference: {
						column: "name",
						slug: schema.slug,
						type: "entity-column",
					},
				},
			},
			filter: {
				operator: "eq",
				type: "comparison",
				right: { type: "literal", value: "2021" },
				left: {
					type: "reference",
					reference: { type: "computed-field", key: "nextYear" },
				},
			},
			computedFields: [
				{
					key: "nextYear",
					expression: {
						operator: "add",
						type: "arithmetic",
						right: { type: "literal", value: 1 },
						left: {
							type: "reference",
							reference: {
								property: "year",
								slug: schema.slug,
								type: "schema-property",
							},
						},
					},
				},
			],
			fields: [buildRuntimeField("title", [entityField(schema.slug, "name")])],
		} as unknown as Parameters<typeof executeViewRuntime>[2]);

		expect(imageSortResult.response.status).toBe(400);
		expect(imageSortResult.error?.error?.message).toBe(
			"Image expressions are display-only and cannot be used in sorting",
		);
		expect(mismatchedFilterResult.response.status).toBe(400);
		expect(mismatchedFilterResult.error?.error?.message).toBe(
			"Filter operator 'eq' requires compatible expression types, received 'integer' and 'string'",
		);
	});

	it("supports arithmetic, normalization, concat, and conditionals in runtime expressions", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const categoryExpression = {
			type: "reference" as const,
			reference: {
				slug: schema.slug,
				property: "category",
				type: "schema-property" as const,
			},
		};
		const nameExpression = {
			type: "reference" as const,
			reference: {
				column: "name",
				slug: schema.slug,
				type: "entity-column" as const,
			},
		};
		const yearExpression = {
			type: "reference" as const,
			reference: {
				property: "year",
				slug: schema.slug,
				type: "schema-property" as const,
			},
		};

		const { data, response } = await executeViewRuntime(client, cookies, {
			eventJoins: [],
			entitySchemaSlugs: [schema.slug],
			pagination: { page: 1, limit: 1 },
			sort: { direction: "asc", expression: nameExpression },
			filter: {
				operator: "eq",
				type: "comparison",
				left: nameExpression,
				right: { type: "literal", value: "Gamma Phone" },
			},
			computedFields: [
				{
					key: "nextYear",
					expression: {
						operator: "add",
						type: "arithmetic",
						left: yearExpression,
						right: { type: "literal", value: 1 },
					},
				},
			],
			fields: [
				buildRuntimeField("nextYear", ["computed.nextYear"]),
				buildRuntimeField("rounded", {
					type: "round",
					expression: {
						type: "arithmetic",
						operator: "divide",
						left: yearExpression,
						right: { type: "literal", value: 3 },
					},
				}),
				buildRuntimeField("floored", {
					type: "floor",
					expression: {
						type: "arithmetic",
						operator: "divide",
						left: yearExpression,
						right: { type: "literal", value: 3 },
					},
				}),
				buildRuntimeField("wholeYear", {
					type: "integer",
					expression: yearExpression,
				}),
				buildRuntimeField("label", {
					type: "concat",
					values: [
						{ type: "literal", value: "Gamma / " },
						categoryExpression,
						{ type: "literal", value: " / " },
						yearExpression,
					],
				}),
				buildRuntimeField("badge", {
					type: "conditional",
					whenTrue: { type: "literal", value: "modern" },
					whenFalse: { type: "literal", value: "classic" },
					condition: {
						operator: "gte",
						type: "comparison",
						left: yearExpression,
						right: { type: "literal", value: 2020 },
					},
				}),
			],
		} as unknown as Parameters<typeof executeViewRuntime>[2]);

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.fields).toEqual([
			{ key: "nextYear", kind: "number", value: 2021 },
			{ key: "rounded", kind: "number", value: 673 },
			{ key: "floored", kind: "number", value: 673 },
			{ key: "wholeYear", kind: "number", value: 2020 },
			{ key: "label", kind: "text", value: "Gamma / phone / 2020" },
			{ key: "badge", kind: "text", value: "modern" },
		]);
	});

	it("truncates integer normalization toward zero for fractional values", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const yearExpression = {
			type: "reference" as const,
			reference: {
				property: "year",
				slug: schema.slug,
				type: "schema-property" as const,
			},
		};

		const { data, response } = await executeViewRuntime(client, cookies, {
			eventJoins: [],
			computedFields: [],
			entitySchemaSlugs: [schema.slug],
			pagination: { page: 1, limit: 1 },
			filter: {
				operator: "eq",
				type: "comparison",
				right: { type: "literal", value: "Alpha Phone" },
				left: {
					type: "reference",
					reference: {
						column: "name",
						slug: schema.slug,
						type: "entity-column",
					},
				},
			},
			sort: {
				direction: "asc",
				expression: {
					type: "reference",
					reference: {
						column: "name",
						slug: schema.slug,
						type: "entity-column",
					},
				},
			},
			fields: [
				buildRuntimeField("integerNormalized", {
					type: "integer",
					expression: {
						type: "arithmetic",
						operator: "divide",
						left: yearExpression,
						right: { type: "literal", value: 365 },
					},
				}),
			],
		} as unknown as Parameters<typeof executeViewRuntime>[2]);

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.fields).toEqual([
			{ key: "integerNormalized", kind: "number", value: 5 },
		]);
	});

	it("supports eq, neq, gt, gte, lt, lte, in, isNull, and isNotNull filters", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const scenarios = [
			{
				expected: ["Alpha Phone", "Gamma Phone"],
				filters: [
					{
						value: "phone",
						op: "eq" as const,
						field: entityField(schema.slug, "category"),
					},
				],
			},
			{
				expected: ["Beta Tablet", "Delta Watch"],
				filters: [
					{
						value: "phone",
						op: "neq" as const,
						field: entityField(schema.slug, "category"),
					},
				],
			},
			{
				expected: ["Delta Watch", "Gamma Phone"],
				filters: [
					{
						value: 2019,
						op: "gt" as const,
						field: entityField(schema.slug, "year"),
					},
				],
			},
			{
				expected: ["Delta Watch", "Gamma Phone"],
				filters: [
					{
						value: 2020,
						op: "gte" as const,
						field: entityField(schema.slug, "year"),
					},
				],
			},
			{
				expected: ["Alpha Phone", "Beta Tablet"],
				filters: [
					{
						value: 2020,
						op: "lt" as const,
						field: entityField(schema.slug, "year"),
					},
				],
			},
			{
				expected: ["Alpha Phone", "Beta Tablet"],
				filters: [
					{
						value: 2019,
						op: "lte" as const,
						field: entityField(schema.slug, "year"),
					},
				],
			},
			{
				expected: ["Beta Tablet", "Delta Watch"],
				filters: [
					{
						op: "in" as const,
						value: ["tablet", "wearable"],
						field: entityField(schema.slug, "category"),
					},
				],
			},
			{
				expected: ["Omega Prototype"],
				filters: [
					{
						op: "isNull" as const,
						field: entityField(schema.slug, "category"),
					},
				],
			},
			{
				expected: ["Alpha Phone", "Beta Tablet", "Delta Watch", "Gamma Phone"],
				filters: [
					{
						op: "isNotNull" as const,
						field: entityField(schema.slug, "category"),
					},
				],
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
					{ op: "gte", field: entityField(schema.slug, "year"), value: 2020 },
					{
						op: "eq",
						value: "phone",
						field: entityField(schema.slug, "category"),
					},
				],
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual(["Gamma Phone"]);
	});

	it("applies explicit entity name filters across every schema", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createCrossSchemaRuntimeFixture();
		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				displayConfiguration: buildGridDisplayConfiguration({
					badgeProperty: null,
					subtitleProperty: null,
				}),
				filters: [
					{
						op: "in",
						value: ["Alpha Phone", "Delta Tablet"],
						field: entityField(smartphoneSlug, "name"),
					},
					{
						op: "in",
						value: ["Alpha Phone", "Delta Tablet"],
						field: entityField(tabletSlug, "name"),
					},
				],
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
				displayConfiguration: buildGridDisplayConfiguration({
					badgeProperty: null,
					subtitleProperty: null,
				}),
				filters: [
					{
						op: "gte",
						value: 2020,
						field: entityField(smartphoneSlug, "year"),
					},
					{
						op: "gte",
						value: 2021,
						field: entityField(tabletSlug, "releaseYear"),
					},
				],
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
				sort: { fields: [entityField(schema.slug, "name")], direction: "desc" },
			}),
		);
		const yearResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				sort: { fields: [entityField(schema.slug, "year")], direction: "asc" },
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

	it("filters, sorts, and displays entity @id", async () => {
		const { client, cookies, entityIdsByName, schema } =
			await createSingleSchemaRuntimeFixture();
		const targetId = entityIdsByName["Gamma Phone"];
		if (!targetId) {
			throw new Error("Missing runtime entity fixture id for @id test");
		}

		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildTableRequest({
				entitySchemaSlugs: [schema.slug],
				sort: { fields: [entityField(schema.slug, "id")], direction: "asc" },
				displayConfiguration: buildTableDisplayConfiguration([
					{ label: "Id", property: [entityField(schema.slug, "id")] },
					{ label: "Name", property: [entityField(schema.slug, "name")] },
				]),
				filters: [
					{
						op: "eq",
						value: targetId,
						field: entityField(schema.slug, "id"),
					},
				],
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items).toHaveLength(1);
		expect(data?.data.items[0]?.id).toBe(targetId);
		expect(data?.data.items[0]?.name).toBe("Gamma Phone");
		expect(data?.data.items[0]?.fields).toEqual([
			{ key: "column_0", kind: "text", value: targetId },
			{ key: "column_1", kind: "text", value: "Gamma Phone" },
		]);
	});

	it("filters entity @id with contains", async () => {
		const { client, cookies, entityIdsByName, schema } =
			await createSingleSchemaRuntimeFixture();
		const targetId = entityIdsByName["Beta Tablet"];
		if (!targetId) {
			throw new Error(
				"Missing runtime entity fixture id for @id contains test",
			);
		}
		const suffix = targetId.slice(-8);

		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				displayConfiguration: buildGridDisplayConfiguration({
					badgeProperty: [entityField(schema.slug, "id")],
					subtitleProperty: null,
				}),
				filters: [
					{
						value: suffix,
						op: "contains",
						field: entityField(schema.slug, "id"),
					},
				],
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual(["Beta Tablet"]);
		expect(getField(data?.data.items[0], "badge")).toEqual({
			key: "badge",
			kind: "text",
			value: targetId,
		});
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
					fields: [
						entityField(smartphoneSlug, "year"),
						entityField(tabletSlug, "releaseYear"),
					],
				},
			}),
		);

		await createRuntimeEntity({
			client,
			cookies,
			name: "Null Tablet",
			entitySchemaId: tabletSchema.schemaId,
			properties: { maker: "Ghost" },
		});

		const nullsLastResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				displayConfiguration: neutralDisplay,
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				sort: {
					direction: "asc",
					fields: [
						entityField(smartphoneSlug, "year"),
						entityField(tabletSlug, "releaseYear"),
					],
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
					{
						op: "eq",
						value: "console",
						field: entityField(schema.slug, "category"),
					},
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
					{
						op: "eq",
						value: "phone",
						field: entityField(schema.slug, "category"),
					},
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
					{
						op: "eq",
						value: "console",
						field: entityField(schema.slug, "category"),
					},
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
		expect(result.error?.error?.message).toContain(
			"Sort expressions must resolve to a sortable scalar value",
		);
	});

	it("filters with contains using ilike on string properties and entity @name", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();

		const nameResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [
					{
						op: "contains",
						value: "Phone",
						field: entityField(schema.slug, "name"),
					},
				],
			}),
		);
		const categoryResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [
					{
						op: "contains",
						value: "phone",
						field: entityField(schema.slug, "category"),
					},
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
				fields: { tags: { type: "array", items: { type: "string" } } },
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
			properties: { tags: ["drama"] },
			entitySchemaId: schema.schemaId,
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
				displayConfiguration: buildGridDisplayConfiguration({
					badgeProperty: null,
					subtitleProperty: null,
				}),
				filters: [
					{
						op: "contains",
						value: "action",
						field: entityField(schema.slug, "tags"),
					},
				],
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
					{
						op: "contains",
						field: entityField(schema.slug, "sku"),
						value: "A%B",
					},
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
					{
						value: "A_B",
						op: "contains",
						field: entityField(schema.slug, "sku"),
					},
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
				fields: { tags: { type: "array", items: { type: "string" } } },
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
						field: entityField(schema.slug, "tags"),
					},
				],
			}),
		);

		expect(result.response.status).toBe(400);
		expect(result.error?.error?.message).toContain(
			"requires a scalar or object item expression",
		);
	});

	registerViewRuntimePresentationAndErrorTests();
});
