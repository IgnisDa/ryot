import { describe, expect, it } from "bun:test";
import {
	buildComputedField,
	buildGridDisplayConfiguration,
	buildGridRequest,
	buildQueryEngineField,
	buildTableDisplayConfiguration,
	buildTableRequest,
	computedFieldExpression,
	createAuthenticatedClient,
	createCrossSchemaQueryEngineFixture,
	createEntitySchema,
	createEventSchema,
	createQueryEngineEntity,
	createSingleSchemaQueryEngineFixture,
	createTracker,
	entityColumnExpression,
	entityField,
	executeQueryEngine,
	findBuiltinSchemaWithProviders,
	getQueryEngineFieldOrThrow,
	literalExpression,
	schemaPropertyExpression,
	seedMediaEntity,
} from "../fixtures";
import { getPgClient } from "../setup";
import { registerQueryEnginePresentationAndErrorTests } from "../test-support/query-engine-suite";

async function insertLibraryMembership(input: {
	userId: string;
	mediaEntityId: string;
}) {
	const pg = getPgClient();

	const libraryResult = await pg.query<{ id: string }>(
		`select e.id
		 from entity e
		 inner join entity_schema es on es.id = e.entity_schema_id
		 where e.user_id = $1
		   and es.slug = 'library'
		   and es.user_id is null
		 limit 1`,
		[input.userId],
	);
	const libraryEntityId = libraryResult.rows[0]?.id;
	if (!libraryEntityId) {
		throw new Error(`Missing library entity for user '${input.userId}'`);
	}

	const schemaResult = await pg.query<{ id: string }>(
		`select id from relationship_schema
		 where slug = 'in-library' and user_id is null
		 limit 1`,
	);
	const inLibrarySchemaId = schemaResult.rows[0]?.id;
	if (!inLibrarySchemaId) {
		throw new Error("Missing in-library relationship schema");
	}

	await pg.query(
		`insert into relationship (
				id,
				user_id,
				relationship_schema_id,
				properties,
				source_entity_id,
				target_entity_id
			) values ($1, $2, $3, $4::jsonb, $5, $6)
			on conflict (user_id, source_entity_id, target_entity_id, relationship_schema_id) do nothing`,
		[
			crypto.randomUUID(),
			input.userId,
			inLibrarySchemaId,
			JSON.stringify({}),
			input.mediaEntityId,
			libraryEntityId,
		],
	);
}

describe("Query engine E2E", () => {
	it("includes a global media entity when the user has it in their library", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const provider = schema.providers[0];
		if (!provider) {
			throw new Error("No provider found");
		}

		const entity = await seedMediaEntity({
			image: null,
			userId: null,
			properties: {},
			entitySchemaId: schema.id,
			sandboxScriptId: provider.scriptId,
			name: `Library Query Entity ${crypto.randomUUID()}`,
			externalId: `library-query-entity-${crypto.randomUUID()}`,
		});
		await insertLibraryMembership({ mediaEntityId: entity.id, userId });

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				relationships: [{ relationshipSchemaSlug: "in-library" }],
				displayConfiguration: buildGridDisplayConfiguration(
					{
						calloutProperty: null,
						primarySubtitleProperty: null,
						secondarySubtitleProperty: null,
					},
					[schema.slug],
				),
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression(entity.name),
					left: entityColumnExpression(schema.slug, "name"),
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual([entity.name]);
	});

	it("isolates global media entities by library membership per user", async () => {
		const userA = await createAuthenticatedClient();
		const userB = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(
			userA.client,
			userA.cookies,
		);
		const provider = schema.providers[0];
		if (!provider) {
			throw new Error("No provider found");
		}

		const entity = await seedMediaEntity({
			image: null,
			userId: null,
			properties: {},
			entitySchemaId: schema.id,
			sandboxScriptId: provider.scriptId,
			name: `Isolated Library Entity ${crypto.randomUUID()}`,
			externalId: `isolated-library-entity-${crypto.randomUUID()}`,
		});
		await insertLibraryMembership({
			userId: userA.userId,
			mediaEntityId: entity.id,
		});

		const request = buildGridRequest({
			entitySchemaSlugs: [schema.slug],
			relationships: [{ relationshipSchemaSlug: "in-library" }],
			displayConfiguration: buildGridDisplayConfiguration(
				{
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				},
				[schema.slug],
			),
			filter: {
				operator: "eq",
				type: "comparison",
				right: literalExpression(entity.name),
				left: entityColumnExpression(schema.slug, "name"),
			},
		});

		const userAResult = await executeQueryEngine(
			userA.client,
			userA.cookies,
			request,
		);
		const userBResult = await executeQueryEngine(
			userB.client,
			userB.cookies,
			request,
		);

		expect(userAResult.response.status).toBe(200);
		expect(userAResult.data?.data.items.map((item) => item.name)).toEqual([
			entity.name,
		]);
		expect(userBResult.response.status).toBe(200);
		expect(userBResult.data?.data.items).toEqual([]);
	});

	it("executes a simple single-schema query with the full response shape", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(
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
		expect(getQueryEngineFieldOrThrow(firstItem, "callout")).toEqual({
			key: "callout",
			kind: "text",
			value: "phone",
		});
		expect(getQueryEngineFieldOrThrow(firstItem, "primarySubtitle")).toEqual({
			key: "primarySubtitle",
			kind: "number",
			value: 2018,
		});
		expect(getQueryEngineFieldOrThrow(firstItem, "secondarySubtitle")).toEqual({
			key: "secondarySubtitle",
			kind: "null",
			value: null,
		});
		expect(getQueryEngineFieldOrThrow(firstItem, "title")).toEqual({
			key: "title",
			kind: "text",
			value: "Alpha Phone",
		});
		expect(getQueryEngineFieldOrThrow(firstItem, "image")).toEqual({
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
			await createSingleSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(client, cookies, {
			entitySchemaSlugs: [schema.slug],
			eventJoins: [],
			pagination: { page: 1, limit: 1 },
			sort: {
				direction: "asc",
				expression: entityColumnExpression(schema.slug, "name"),
			},
			fields: [
				buildQueryEngineField("label", { type: "literal", value: "Pinned" }),
				buildQueryEngineField("yearOrFallback", {
					type: "coalesce",
					values: [
						{ type: "literal", value: null },
						{
							type: "reference",
							reference: {
								slug: schema.slug,
								type: "entity",
								path: ["properties", "year"],
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
			await createSingleSchemaQueryEngineFixture();
		await createEventSchema(client, cookies, {
			name: "Review",
			slug: "review",
			entitySchemaId: schema.schemaId,
			propertiesSchema: {
				fields: {
					label: { type: "string", label: "Label" },
					rating: { type: "number", label: "Rating" },
				},
			},
		});

		const { data, response } = await executeQueryEngine(client, cookies, {
			entitySchemaSlugs: [schema.slug],
			pagination: { page: 1, limit: 5 },
			sort: {
				expression: entityColumnExpression(schema.slug, "name"),
				direction: "asc",
			},
			fields: [
				buildQueryEngineField("title", ["computed.entityLabel"]),
				buildQueryEngineField("badge", ["computed.reviewOrLabel"]),
				buildQueryEngineField("rawReview", ["computed.reviewLabel"]),
			],
			eventJoins: [
				{ key: "review", kind: "latestEvent", eventSchemaSlug: "review" },
			],
			computedFields: [
				buildComputedField("entityLabel", [entityField(schema.slug, "name")]),
				buildComputedField("reviewLabel", ["event.review.properties.label"]),
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
			await createSingleSchemaQueryEngineFixture();
		const yearExpression = schemaPropertyExpression(schema.slug, "year");
		const nextYearReference = computedFieldExpression("nextYear");
		const labelReference = computedFieldExpression("label");

		const { data, response } = await executeQueryEngine(client, cookies, {
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
				buildQueryEngineField("label", labelReference),
				buildQueryEngineField("nextYear", nextYearReference),
			],
		});

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
			await createSingleSchemaQueryEngineFixture();
		const missingComputedFieldResult = await executeQueryEngine(
			client,
			cookies,
			{
				eventJoins: [],
				computedFields: [],
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 1, limit: 5 },
				sort: {
					direction: "asc",
					expression: entityColumnExpression(schema.slug, "name"),
				},
				filter: null,
				fields: [buildQueryEngineField("title", ["computed.missingLabel"])],
			},
		);
		const cycleResult = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			entitySchemaSlugs: [schema.slug],
			pagination: { page: 1, limit: 5 },
			sort: {
				direction: "asc",
				expression: entityColumnExpression(schema.slug, "name"),
			},
			filter: null,
			computedFields: [
				buildComputedField("first", ["computed.second"]),
				buildComputedField("second", ["computed.first"]),
			],
			fields: [buildQueryEngineField("title", ["computed.first"])],
		});

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
			await createSingleSchemaQueryEngineFixture();
		const imageSortResult = await executeQueryEngine(client, cookies, {
			filter: null,
			eventJoins: [],
			entitySchemaSlugs: [schema.slug],
			pagination: { page: 1, limit: 5 },
			sort: {
				direction: "asc",
				expression: computedFieldExpression("cover"),
			},
			computedFields: [
				{
					key: "cover",
					expression: entityColumnExpression(schema.slug, "image"),
				},
			],
			fields: [
				buildQueryEngineField("image", [entityField(schema.slug, "image")]),
			],
		});
		const mismatchedFilterResult = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			entitySchemaSlugs: [schema.slug],
			pagination: { page: 1, limit: 5 },
			sort: {
				direction: "asc",
				expression: entityColumnExpression(schema.slug, "name"),
			},
			filter: {
				operator: "eq",
				type: "comparison",
				right: { type: "literal", value: "2021" },
				left: computedFieldExpression("nextYear"),
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
								type: "entity",
								slug: schema.slug,
								path: ["properties", "year"],
							},
						},
					},
				},
			],
			fields: [
				buildQueryEngineField("title", [entityField(schema.slug, "name")]),
			],
		});

		expect(imageSortResult.response.status).toBe(400);
		expect(imageSortResult.error?.error?.message).toBe(
			"Image expressions are display-only and cannot be used in sorting",
		);
		expect(mismatchedFilterResult.response.status).toBe(400);
		expect(mismatchedFilterResult.error?.error?.message).toBe(
			"Filter operator 'eq' requires compatible expression types, received 'integer' and 'string'",
		);
	});

	it("returns 404 when the runtime request references a schema slug that is not visible", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const result = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({ entitySchemaSlugs: ["does-not-exist"] }),
		);

		expect(result.response.status).toBe(404);
		expect(result.error?.error?.message).toContain(
			"Schema 'does-not-exist' not found",
		);
	});

	it("supports arithmetic, normalization, concat, and conditionals in runtime expressions", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaQueryEngineFixture();
		const categoryExpression = schemaPropertyExpression(
			schema.slug,
			"category",
		);
		const nameExpression = entityColumnExpression(schema.slug, "name");
		const yearExpression = schemaPropertyExpression(schema.slug, "year");

		const { data, response } = await executeQueryEngine(client, cookies, {
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
				buildQueryEngineField("nextYear", ["computed.nextYear"]),
				buildQueryEngineField("rounded", {
					type: "round",
					expression: {
						type: "arithmetic",
						operator: "divide",
						left: yearExpression,
						right: { type: "literal", value: 3 },
					},
				}),
				buildQueryEngineField("floored", {
					type: "floor",
					expression: {
						type: "arithmetic",
						operator: "divide",
						left: yearExpression,
						right: { type: "literal", value: 3 },
					},
				}),
				buildQueryEngineField("wholeYear", {
					type: "integer",
					expression: yearExpression,
				}),
				buildQueryEngineField("label", {
					type: "concat",
					values: [
						{ type: "literal", value: "Gamma / " },
						categoryExpression,
						{ type: "literal", value: " / " },
						yearExpression,
					],
				}),
				buildQueryEngineField("badge", {
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
		});

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
			await createSingleSchemaQueryEngineFixture();
		const yearExpression = schemaPropertyExpression(schema.slug, "year");

		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			computedFields: [],
			entitySchemaSlugs: [schema.slug],
			pagination: { page: 1, limit: 1 },
			filter: {
				operator: "eq",
				type: "comparison",
				right: { type: "literal", value: "Alpha Phone" },
				left: entityColumnExpression(schema.slug, "name"),
			},
			sort: {
				direction: "asc",
				expression: entityColumnExpression(schema.slug, "name"),
			},
			fields: [
				buildQueryEngineField("integerNormalized", {
					type: "integer",
					expression: {
						type: "arithmetic",
						operator: "divide",
						left: yearExpression,
						right: { type: "literal", value: 365 },
					},
				}),
			],
		});

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.fields).toEqual([
			{ key: "integerNormalized", kind: "number", value: 5 },
		]);
	});

	it("supports eq, neq, gt, gte, lt, lte, in, isNull, and isNotNull filters", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaQueryEngineFixture();
		const scenarios = [
			{
				expected: ["Alpha Phone", "Gamma Phone"],
				filter: {
					type: "comparison" as const,
					operator: "eq" as const,
					left: schemaPropertyExpression(schema.slug, "category"),
					right: literalExpression("phone"),
				},
			},
			{
				expected: ["Beta Tablet", "Delta Watch"],
				filter: {
					type: "comparison" as const,
					operator: "neq" as const,
					left: schemaPropertyExpression(schema.slug, "category"),
					right: literalExpression("phone"),
				},
			},
			{
				expected: ["Delta Watch", "Gamma Phone"],
				filter: {
					type: "comparison" as const,
					operator: "gt" as const,
					left: schemaPropertyExpression(schema.slug, "year"),
					right: literalExpression(2019),
				},
			},
			{
				expected: ["Delta Watch", "Gamma Phone"],
				filter: {
					type: "comparison" as const,
					operator: "gte" as const,
					left: schemaPropertyExpression(schema.slug, "year"),
					right: literalExpression(2020),
				},
			},
			{
				expected: ["Alpha Phone", "Beta Tablet"],
				filter: {
					type: "comparison" as const,
					operator: "lt" as const,
					left: schemaPropertyExpression(schema.slug, "year"),
					right: literalExpression(2020),
				},
			},
			{
				expected: ["Alpha Phone", "Beta Tablet"],
				filter: {
					type: "comparison" as const,
					operator: "lte" as const,
					left: schemaPropertyExpression(schema.slug, "year"),
					right: literalExpression(2019),
				},
			},
			{
				expected: ["Beta Tablet", "Delta Watch"],
				filter: {
					type: "in" as const,
					expression: schemaPropertyExpression(schema.slug, "category"),
					values: [literalExpression("tablet"), literalExpression("wearable")],
				},
			},
			{
				expected: ["Omega Prototype"],
				filter: {
					type: "isNull" as const,
					expression: schemaPropertyExpression(schema.slug, "category"),
				},
			},
			{
				expected: ["Alpha Phone", "Beta Tablet", "Delta Watch", "Gamma Phone"],
				filter: {
					type: "isNotNull" as const,
					expression: schemaPropertyExpression(schema.slug, "category"),
				},
			},
		];

		for (const scenario of scenarios) {
			const { data, response } = await executeQueryEngine(
				client,
				cookies,
				buildGridRequest({
					filter: scenario.filter,
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
			await createSingleSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filter: {
					type: "and",
					predicates: [
						{
							type: "comparison",
							operator: "gte",
							left: schemaPropertyExpression(schema.slug, "year"),
							right: literalExpression(2020),
						},
						{
							type: "comparison",
							operator: "eq",
							left: schemaPropertyExpression(schema.slug, "category"),
							right: literalExpression("phone"),
						},
					],
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual(["Gamma Phone"]);
	});

	it("applies explicit entity name filters across every schema", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createCrossSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				displayConfiguration: buildGridDisplayConfiguration({
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				}),
				filter: {
					type: "or",
					predicates: [
						{
							type: "in",
							expression: entityColumnExpression(smartphoneSlug, "name"),
							values: [
								literalExpression("Alpha Phone"),
								literalExpression("Delta Tablet"),
							],
						},
						{
							type: "in",
							expression: entityColumnExpression(tabletSlug, "name"),
							values: [
								literalExpression("Alpha Phone"),
								literalExpression("Delta Tablet"),
							],
						},
					],
				},
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
			await createCrossSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				displayConfiguration: buildGridDisplayConfiguration({
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				}),
				filter: {
					type: "or",
					predicates: [
						{
							type: "comparison",
							operator: "gte",
							left: schemaPropertyExpression(smartphoneSlug, "year"),
							right: literalExpression(2020),
						},
						{
							type: "comparison",
							operator: "gte",
							left: schemaPropertyExpression(tabletSlug, "releaseYear"),
							right: literalExpression(2021),
						},
					],
				},
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
			await createSingleSchemaQueryEngineFixture();
		const ascResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({ entitySchemaSlugs: [schema.slug] }),
		);
		const descResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				sort: {
					expression: entityColumnExpression(schema.slug, "name"),
					direction: "desc",
				},
			}),
		);
		const yearResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				sort: {
					expression: schemaPropertyExpression(schema.slug, "year"),
					direction: "asc",
				},
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
			await createSingleSchemaQueryEngineFixture();
		const targetId = entityIdsByName["Gamma Phone"];
		if (!targetId) {
			throw new Error("Missing runtime entity fixture id for @id test");
		}

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildTableRequest({
				entitySchemaSlugs: [schema.slug],
				sort: {
					expression: entityColumnExpression(schema.slug, "id"),
					direction: "asc",
				},
				displayConfiguration: buildTableDisplayConfiguration([
					{ label: "Id", property: [entityField(schema.slug, "id")] },
					{ label: "Name", property: [entityField(schema.slug, "name")] },
				]),
				filter: {
					type: "comparison",
					operator: "eq",
					left: entityColumnExpression(schema.slug, "id"),
					right: literalExpression(targetId),
				},
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
			await createSingleSchemaQueryEngineFixture();
		const targetId = entityIdsByName["Beta Tablet"];
		if (!targetId) {
			throw new Error(
				"Missing runtime entity fixture id for @id contains test",
			);
		}
		const suffix = targetId.slice(-8);

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				displayConfiguration: buildGridDisplayConfiguration({
					calloutProperty: [entityField(schema.slug, "id")],
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				}),
				filter: {
					type: "contains",
					expression: entityColumnExpression(schema.slug, "id"),
					value: literalExpression(suffix),
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual(["Beta Tablet"]);
		expect(getQueryEngineFieldOrThrow(data?.data.items[0], "callout")).toEqual({
			key: "callout",
			kind: "text",
			value: targetId,
		});
	});

	it("sorts across schemas with COALESCE and keeps null values last", async () => {
		const { client, cookies, smartphoneSlug, tabletSchema, tabletSlug } =
			await createCrossSchemaQueryEngineFixture();
		const neutralDisplay = buildGridDisplayConfiguration({
			calloutProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
		});
		const coalesceSort = {
			direction: "asc" as const,
			expression: {
				type: "coalesce" as const,
				values: [
					schemaPropertyExpression(smartphoneSlug, "year"),
					schemaPropertyExpression(tabletSlug, "releaseYear"),
				],
			},
		};
		const coalesceResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				displayConfiguration: neutralDisplay,
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				sort: coalesceSort,
			}),
		);

		await createQueryEngineEntity({
			client,
			cookies,
			name: "Null Tablet",
			entitySchemaId: tabletSchema.schemaId,
			properties: { maker: "Ghost" },
		});

		const nullsLastResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				displayConfiguration: neutralDisplay,
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				sort: coalesceSort,
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
			await createSingleSchemaQueryEngineFixture();
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
			const { data, response } = await executeQueryEngine(
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
			await createSingleSchemaQueryEngineFixture();
		const emptyPageResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 100, limit: 2 },
			}),
		);
		const emptyResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filter: {
					type: "comparison",
					operator: "eq",
					left: schemaPropertyExpression(schema.slug, "category"),
					right: literalExpression("console"),
				},
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
			await createSingleSchemaQueryEngineFixture();
		const outOfRangeFilteredResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 2, limit: 5 },
				filter: {
					type: "comparison",
					operator: "eq",
					left: schemaPropertyExpression(schema.slug, "category"),
					right: literalExpression("phone"),
				},
			}),
		);
		const zeroResultsLaterPage = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 3, limit: 2 },
				filter: {
					type: "comparison",
					operator: "eq",
					left: schemaPropertyExpression(schema.slug, "category"),
					right: literalExpression("console"),
				},
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
			await createSingleSchemaQueryEngineFixture();
		const result = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				sort: { expression: literalExpression(null), direction: "asc" },
			}),
		);

		expect(result.response.status).toBe(400);
		expect(result.error?.error?.message).toContain(
			"Sort expressions must resolve to a sortable scalar value",
		);
	});

	it("filters with contains using ilike on string properties and entity @name", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaQueryEngineFixture();

		const nameResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filter: {
					type: "contains",
					expression: entityColumnExpression(schema.slug, "name"),
					value: literalExpression("Phone"),
				},
			}),
		);
		const categoryResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filter: {
					type: "contains",
					expression: schemaPropertyExpression(schema.slug, "category"),
					value: literalExpression("phone"),
				},
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
					tags: {
						type: "array",
						label: "Tags",
						items: { type: "string", label: "Tag" },
					},
				},
			},
		});

		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			name: "Sci-Fi Movie",
			entitySchemaId: schema.schemaId,
			properties: { tags: ["sci-fi", "action"] },
		});
		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			name: "Drama Movie",
			properties: { tags: ["drama"] },
			entitySchemaId: schema.schemaId,
		});
		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			name: "Action Movie",
			entitySchemaId: schema.schemaId,
			properties: { tags: ["action"] },
		});

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				displayConfiguration: buildGridDisplayConfiguration({
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				}),
				filter: {
					type: "contains",
					expression: schemaPropertyExpression(schema.slug, "tags"),
					value: literalExpression("action"),
				},
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
			propertiesSchema: { fields: { sku: { type: "string", label: "SKU" } } },
		});

		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			name: "Percent Item",
			properties: { sku: "A%B" },
			entitySchemaId: schema.schemaId,
		});
		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			name: "Underscore Item",
			properties: { sku: "A_B" },
			entitySchemaId: schema.schemaId,
		});
		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			name: "Middle Item",
			properties: { sku: "AXB" },
			entitySchemaId: schema.schemaId,
		});

		const neutralDisplay = buildGridDisplayConfiguration({
			calloutProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
		});

		const percentResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				displayConfiguration: neutralDisplay,
				filter: {
					type: "contains",
					expression: schemaPropertyExpression(schema.slug, "sku"),
					value: literalExpression("A%B"),
				},
			}),
		);
		const underscoreResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				displayConfiguration: neutralDisplay,
				filter: {
					type: "contains",
					expression: schemaPropertyExpression(schema.slug, "sku"),
					value: literalExpression("A_B"),
				},
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
					tags: {
						type: "array",
						label: "Tags",
						items: { type: "string", label: "Tag" },
					},
				},
			},
		});

		const result = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				displayConfiguration: buildGridDisplayConfiguration({
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				}),
				filter: {
					type: "contains",
					expression: schemaPropertyExpression(schema.slug, "tags"),
					value: literalExpression(["sci-fi", "action"]),
				},
			}),
		);

		expect(result.response.status).toBe(400);
		expect(result.error?.error?.message).toContain(
			"requires a scalar or object item expression",
		);
	});

	it("displays and filters by externalId and sandboxScriptId on global entities", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const provider = schema.providers[0];
		if (!provider) {
			throw new Error("No provider found");
		}

		const externalId = `ext-id-test-${crypto.randomUUID()}`;
		const entity = await seedMediaEntity({
			externalId,
			image: null,
			userId: null,
			properties: {},
			entitySchemaId: schema.id,
			sandboxScriptId: provider.scriptId,
			name: `External ID Entity ${crypto.randomUUID()}`,
		});
		await insertLibraryMembership({ mediaEntityId: entity.id, userId });

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildTableRequest({
				entitySchemaSlugs: [schema.slug],
				displayConfiguration: buildTableDisplayConfiguration([
					{
						label: "ExternalId",
						property: [entityField(schema.slug, "externalId")],
					},
					{
						label: "SandboxScriptId",
						property: [entityField(schema.slug, "sandboxScriptId")],
					},
				]),
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression(externalId),
					left: entityColumnExpression(schema.slug, "externalId"),
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items).toHaveLength(1);
		expect(data?.data.items[0]?.externalId).toBe(externalId);
		expect(data?.data.items[0]?.sandboxScriptId).toBe(provider.scriptId);
		expect(data?.data.items[0]?.fields).toEqual([
			{ key: "column_0", kind: "text", value: externalId },
			{ key: "column_1", kind: "text", value: provider.scriptId },
		]);
	});

	it("resolves externalId and sandboxScriptId as null for regular user entities", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaQueryEngineFixture();

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildTableRequest({
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 1, limit: 1 },
				displayConfiguration: buildTableDisplayConfiguration([
					{
						label: "ExternalId",
						property: [entityField(schema.slug, "externalId")],
					},
					{
						label: "SandboxScriptId",
						property: [entityField(schema.slug, "sandboxScriptId")],
					},
				]),
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression("Alpha Phone"),
					left: entityColumnExpression(schema.slug, "name"),
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items).toHaveLength(1);
		expect(data?.data.items[0]?.externalId).toBeNull();
		expect(data?.data.items[0]?.sandboxScriptId).toBeNull();
		expect(data?.data.items[0]?.fields).toEqual([
			{ key: "column_0", kind: "null", value: null },
			{ key: "column_1", kind: "null", value: null },
		]);
	});

	it("filters with isNull on externalId to find entities without an external id", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaQueryEngineFixture();

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				displayConfiguration: buildGridDisplayConfiguration({
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				}),
				filter: {
					type: "isNull",
					expression: entityColumnExpression(schema.slug, "externalId"),
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items.length).toBeGreaterThan(0);
		for (const item of data?.data.items ?? []) {
			expect(item.externalId).toBeNull();
		}
	});

	it("resolves externalId correctly in a cross-schema query with both global and user entities", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { schema: mediaSchema } = await findBuiltinSchemaWithProviders(
			client,
			cookies,
		);
		const provider = mediaSchema.providers[0];
		if (!provider) {
			throw new Error("No provider found");
		}

		const externalId = `cross-schema-ext-${crypto.randomUUID()}`;
		const globalEntity = await seedMediaEntity({
			externalId,
			image: null,
			userId: null,
			properties: {},
			entitySchemaId: mediaSchema.id,
			sandboxScriptId: provider.scriptId,
			name: `Cross Schema Global ${crypto.randomUUID()}`,
		});
		await insertLibraryMembership({ userId, mediaEntityId: globalEntity.id });

		const { trackerId } = await createTracker(client, cookies, {
			name: "Cross Schema Tracker",
		});
		const userSchema = await createEntitySchema(client, cookies, {
			trackerId,
			name: "UserItem",
			propertiesSchema: {
				fields: { title: { type: "string" as const, label: "Title" } },
			},
		});
		const userEntityName = `Cross Schema User ${crypto.randomUUID()}`;
		await createQueryEngineEntity({
			client,
			cookies,
			image: null,
			properties: {},
			name: userEntityName,
			entitySchemaId: userSchema.schemaId,
		});

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildTableRequest({
				entitySchemaSlugs: [mediaSchema.slug, userSchema.slug],
				displayConfiguration: buildTableDisplayConfiguration([
					{
						label: "Name",
						property: [
							entityField(mediaSchema.slug, "name"),
							entityField(userSchema.slug, "name"),
						],
					},
					{
						label: "ExternalId",
						property: [
							entityField(mediaSchema.slug, "externalId"),
							entityField(userSchema.slug, "externalId"),
						],
					},
				]),
				filter: {
					type: "or",
					predicates: [
						{
							operator: "eq",
							type: "comparison",
							right: literalExpression(externalId),
							left: entityColumnExpression(mediaSchema.slug, "externalId"),
						},
						{
							operator: "eq",
							type: "comparison",
							right: literalExpression(userEntityName),
							left: entityColumnExpression(userSchema.slug, "name"),
						},
					],
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items).toHaveLength(2);

		const globalItem = data?.data.items.find(
			(item) => item.entitySchemaSlug === mediaSchema.slug,
		);
		const userItem = data?.data.items.find(
			(item) => item.entitySchemaSlug === userSchema.slug,
		);

		expect(globalItem?.externalId).toBe(externalId);
		expect(globalItem?.sandboxScriptId).toBe(provider.scriptId);
		expect(userItem?.externalId).toBeNull();
		expect(userItem?.sandboxScriptId).toBeNull();
	});

	registerQueryEnginePresentationAndErrorTests();
});
