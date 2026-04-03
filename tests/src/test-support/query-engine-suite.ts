import { expect, it } from "bun:test";
import {
	buildGridDisplayConfiguration,
	buildGridRequest,
	buildListRequest,
	buildTableDisplayConfiguration,
	buildTableRequest,
	createAuthenticatedClient,
	createCrossSchemaQueryEngineFixture,
	createEntitySchema,
	createEventSchema,
	createQueryEngineEntity,
	createQueryEngineEvent,
	createSingleSchemaQueryEngineFixture,
	createTracker,
	entityColumnExpression,
	entityField,
	executeQueryEngine,
	getQueryEngineFieldOrThrow,
	literalExpression,
	schemaPropertyExpression,
	toRequiredExpression,
} from "src/fixtures";

async function createImageFallbackFixture() {
	const { client, cookies } = await createAuthenticatedClient();
	const { trackerId } = await createTracker(client, cookies, {
		name: "Fallback Image Tracker",
	});
	const schema = await createEntitySchema(client, cookies, {
		trackerId,
		name: "Fallback Image Device",
		propertiesSchema: {
			fields: { category: { label: "Category", type: "string" } },
		},
	});

	await createQueryEngineEntity({
		client,
		cookies,
		image: null,
		name: "No Image Device",
		entitySchemaId: schema.schemaId,
		properties: { category: "fallback-image" },
	});

	return { client, cookies, schema };
}

async function createLatestEventJoinFixture() {
	const { client, cookies, entityIdsByName, schema } =
		await createSingleSchemaQueryEngineFixture();
	const alphaPhoneId = entityIdsByName["Alpha Phone"];
	const gammaPhoneId = entityIdsByName["Gamma Phone"];
	if (!alphaPhoneId || !gammaPhoneId) {
		throw new Error(
			"Missing runtime entity fixture ids for latest event join test",
		);
	}
	const reviewSchema = await createEventSchema(client, cookies, {
		name: "Review",
		slug: "review",
		entitySchemaId: schema.schemaId,
		propertiesSchema: {
			fields: {
				note: { label: "Note", type: "string" },
				rating: { label: "Rating", type: "number" },
			},
		},
	});

	await createQueryEngineEvent({
		client,
		cookies,
		entityId: alphaPhoneId,
		eventSchemaId: reviewSchema.id,
		properties: { rating: 2, note: "draft" },
	});
	await createQueryEngineEvent({
		client,
		cookies,
		entityId: alphaPhoneId,
		eventSchemaId: reviewSchema.id,
		properties: { rating: 5, note: "final" },
	});
	await createQueryEngineEvent({
		client,
		cookies,
		entityId: gammaPhoneId,
		eventSchemaId: reviewSchema.id,
		properties: { rating: 4, note: "solid" },
	});

	return { client, cookies, schema };
}

async function createMixedLatestEventJoinFixture() {
	const {
		client,
		cookies,
		tabletSlug,
		smartphoneSlug,
		entityIdsByName,
		smartphoneSchema,
	} = await createCrossSchemaQueryEngineFixture();
	const alphaPhoneId = entityIdsByName["Alpha Phone"];
	const gammaPhoneId = entityIdsByName["Gamma Phone"];
	if (!alphaPhoneId || !gammaPhoneId) {
		throw new Error(
			"Missing mixed runtime entity fixture ids for latest event join test",
		);
	}
	const reviewSchema = await createEventSchema(client, cookies, {
		name: "Review",
		slug: "review",
		entitySchemaId: smartphoneSchema.schemaId,
		propertiesSchema: {
			fields: { rating: { label: "Rating", type: "number" } },
		},
	});

	await createQueryEngineEvent({
		client,
		cookies,
		entityId: alphaPhoneId,
		properties: { rating: 5 },
		eventSchemaId: reviewSchema.id,
	});
	await createQueryEngineEvent({
		client,
		cookies,
		entityId: gammaPhoneId,
		properties: { rating: 4 },
		eventSchemaId: reviewSchema.id,
	});

	return { client, cookies, smartphoneSlug, tabletSlug };
}

export function registerQueryEnginePresentationAndErrorTests() {
	it("returns semantic keys for grid and list layouts with raw image unions", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaQueryEngineFixture();

		const gridResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 1, limit: 1 },
			}),
		);
		const listResult = await executeQueryEngine(
			client,
			cookies,
			buildListRequest({
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 1, limit: 1 },
			}),
		);

		expect(gridResult.response.status).toBe(200);
		expect(listResult.response.status).toBe(200);
		expect(
			getQueryEngineFieldOrThrow(gridResult.data?.data.items[0], "badge"),
		).toEqual({
			key: "badge",
			kind: "text",
			value: "phone",
		});
		expect(
			getQueryEngineFieldOrThrow(gridResult.data?.data.items[0], "subtitle"),
		).toEqual({
			key: "subtitle",
			kind: "number",
			value: 2018,
		});
		expect(
			getQueryEngineFieldOrThrow(gridResult.data?.data.items[0], "title"),
		).toEqual({
			key: "title",
			kind: "text",
			value: "Alpha Phone",
		});
		expect(
			getQueryEngineFieldOrThrow(gridResult.data?.data.items[0], "image"),
		).toEqual({
			key: "image",
			kind: "image",
			value: { kind: "remote", url: "https://example.com/alpha-phone.png" },
		});
		expect(
			getQueryEngineFieldOrThrow(listResult.data?.data.items[0], "badge"),
		).toEqual({
			key: "badge",
			kind: "text",
			value: "phone",
		});
		expect(
			getQueryEngineFieldOrThrow(listResult.data?.data.items[0], "subtitle"),
		).toEqual({
			key: "subtitle",
			kind: "number",
			value: 2018,
		});
		expect(
			getQueryEngineFieldOrThrow(listResult.data?.data.items[0], "title"),
		).toEqual({
			key: "title",
			kind: "text",
			value: "Alpha Phone",
		});
		expect(
			getQueryEngineFieldOrThrow(listResult.data?.data.items[0], "image"),
		).toEqual({
			key: "image",
			kind: "image",
			value: { kind: "remote", url: "https://example.com/alpha-phone.png" },
		});
		expect(gridResult.data?.data.items[0]?.image).toEqual(
			getQueryEngineFieldOrThrow(gridResult.data?.data.items[0], "image").value,
		);
	});

	it("returns null wrappers for empty grid display references", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 1, limit: 1 },
				displayConfiguration: buildGridDisplayConfiguration(
					{ badgeProperty: [], subtitleProperty: [] },
					[schema.slug],
				),
			}),
		);

		expect(response.status).toBe(200);
		expect(getQueryEngineFieldOrThrow(data?.data.items[0], "badge")).toEqual({
			key: "badge",
			kind: "null",
			value: null,
		});
		expect(getQueryEngineFieldOrThrow(data?.data.items[0], "subtitle")).toEqual(
			{
				key: "subtitle",
				kind: "null",
				value: null,
			},
		);
		expect(getQueryEngineFieldOrThrow(data?.data.items[0], "title")).toEqual({
			key: "title",
			kind: "text",
			value: "Alpha Phone",
		});
		expect(getQueryEngineFieldOrThrow(data?.data.items[0], "image")).toEqual({
			key: "image",
			kind: "image",
			value: { kind: "remote", url: "https://example.com/alpha-phone.png" },
		});
	});

	it("returns ordered table fields and null wrappers for empty property references", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildTableRequest({
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 1, limit: 1 },
				displayConfiguration: buildTableDisplayConfiguration([
					{ label: "Name", property: [entityField(schema.slug, "name")] },
					{ label: "Year", property: [entityField(schema.slug, "year")] },
					{ label: "Empty", property: [] },
				]),
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.fields).toEqual([
			{ key: "column_0", kind: "text", value: "Alpha Phone" },
			{ key: "column_1", kind: "number", value: 2018 },
			{ key: "column_2", kind: "null", value: null },
		]);
	});

	it("coalesces cross-schema display configuration values", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createCrossSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				sort: {
					direction: "asc",
					expression: {
						type: "coalesce",
						values: [
							schemaPropertyExpression(smartphoneSlug, "year"),
							schemaPropertyExpression(tabletSlug, "releaseYear"),
						],
					},
				},
				displayConfiguration: buildGridDisplayConfiguration(
					{
						badgeProperty: [
							entityField(smartphoneSlug, "year"),
							entityField(tabletSlug, "releaseYear"),
						],
						subtitleProperty: [
							entityField(smartphoneSlug, "manufacturer"),
							entityField(tabletSlug, "maker"),
						],
					},
					[smartphoneSlug, tabletSlug],
				),
			}),
		);

		expect(response.status).toBe(200);
		expect(getQueryEngineFieldOrThrow(data?.data.items[0], "badge")).toEqual({
			key: "badge",
			kind: "number",
			value: 2018,
		});
		expect(getQueryEngineFieldOrThrow(data?.data.items[0], "subtitle")).toEqual(
			{
				key: "subtitle",
				kind: "text",
				value: "Acme",
			},
		);
		expect(getQueryEngineFieldOrThrow(data?.data.items[1], "badge")).toEqual({
			key: "badge",
			kind: "number",
			value: 2019,
		});
		expect(getQueryEngineFieldOrThrow(data?.data.items[1], "subtitle")).toEqual(
			{
				key: "subtitle",
				kind: "text",
				value: "Tabula",
			},
		);
	});

	it("rejects mixed image and text display fallbacks when @image is null", async () => {
		const { client, cookies, schema } = await createImageFallbackFixture();

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression("No Image Device"),
					left: entityColumnExpression(schema.slug, "name"),
				},
				displayConfiguration: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: [entityField(schema.slug, "name")],
					imageProperty: [
						entityField(schema.slug, "image"),
						entityField(schema.slug, "category"),
					],
				},
			}),
		);

		expect(response.status).toBe(400);
		expect(data).toBeUndefined();
	});

	it("rejects mixed image and text list fallbacks when @image is null", async () => {
		const { client, cookies, schema } = await createImageFallbackFixture();

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildListRequest({
				entitySchemaSlugs: [schema.slug],
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression("No Image Device"),
					left: entityColumnExpression(schema.slug, "name"),
				},
				displayConfiguration: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: [entityField(schema.slug, "name")],
					imageProperty: [
						entityField(schema.slug, "image"),
						entityField(schema.slug, "category"),
					],
				},
			}),
		);

		expect(response.status).toBe(400);
		expect(data).toBeUndefined();
	});

	it("rejects mixed image and text table fallbacks when @image is null", async () => {
		const { client, cookies, schema } = await createImageFallbackFixture();

		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildTableRequest({
				entitySchemaSlugs: [schema.slug],
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression("No Image Device"),
					left: entityColumnExpression(schema.slug, "name"),
				},
				displayConfiguration: buildTableDisplayConfiguration([
					{
						label: "Image",
						property: [
							entityField(schema.slug, "image"),
							entityField(schema.slug, "category"),
						],
					},
					{ label: "Name", property: [entityField(schema.slug, "name")] },
				]),
			}),
		);

		expect(response.status).toBe(400);
		expect(data).toBeUndefined();
	});

	it("filters, sorts, and displays latest-event join data", async () => {
		const { client, cookies, schema } = await createLatestEventJoinFixture();
		const reviewRatingRef = toRequiredExpression(["event.review.rating"]);
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildTableRequest({
				entitySchemaSlugs: [schema.slug],
				sort: { expression: reviewRatingRef, direction: "desc" },
				filter: {
					type: "comparison",
					operator: "gte",
					left: reviewRatingRef,
					right: literalExpression(4),
				},
				eventJoins: [
					{ key: "review", kind: "latestEvent", eventSchemaSlug: "review" },
				],
				displayConfiguration: buildTableDisplayConfiguration([
					{ label: "Name", property: [entityField(schema.slug, "name")] },
					{ label: "Rating", property: ["event.review.rating"] },
					{ label: "Reviewed", property: ["event.review.@createdAt"] },
				]),
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Alpha Phone",
			"Gamma Phone",
		]);
		expect(data?.data.items[0]?.fields).toMatchObject([
			{ key: "column_0", kind: "text", value: "Alpha Phone" },
			{ key: "column_1", kind: "number", value: 5 },
			{ key: "column_2", kind: "date" },
		]);
		expect(data?.data.items[1]?.fields).toMatchObject([
			{ key: "column_0", kind: "text", value: "Gamma Phone" },
			{ key: "column_1", kind: "number", value: 4 },
			{ key: "column_2", kind: "date" },
		]);
	});

	it("treats missing event schemas and missing event rows as null join values", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createMixedLatestEventJoinFixture();
		const reviewRatingRef = toRequiredExpression(["event.review.rating"]);
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				filter: { type: "isNull", expression: reviewRatingRef },
				eventJoins: [
					{ key: "review", kind: "latestEvent", eventSchemaSlug: "review" },
				],
				displayConfiguration: buildGridDisplayConfiguration({
					subtitleProperty: null,
					badgeProperty: ["event.review.rating"],
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Beta Tablet",
			"Delta Tablet",
			"Omega Phone",
		]);
		for (const item of data?.data.items ?? []) {
			expect(getQueryEngineFieldOrThrow(item, "badge")).toEqual({
				key: "badge",
				kind: "null",
				value: null,
			});
		}
	});

	it("returns only entities with a non-null event join value for isNotNull", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createMixedLatestEventJoinFixture();
		const reviewRatingRef = toRequiredExpression(["event.review.rating"]);
		const { data, response } = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				filter: { type: "isNotNull", expression: reviewRatingRef },
				eventJoins: [
					{ key: "review", kind: "latestEvent", eventSchemaSlug: "review" },
				],
				displayConfiguration: buildGridDisplayConfiguration({
					subtitleProperty: null,
					badgeProperty: ["event.review.rating"],
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items.map((item) => item.name)).toEqual([
			"Alpha Phone",
			"Gamma Phone",
		]);
		for (const item of data?.data.items ?? []) {
			expect(getQueryEngineFieldOrThrow(item, "badge").kind).toBe("number");
		}
	});

	it("returns 404 and 400 errors for invalid runtime requests", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaQueryEngineFixture();
		const missingSchemaResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({ entitySchemaSlugs: ["missing-schema"] }),
		);
		const missingPropertyResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression("phone"),
					left: schemaPropertyExpression(schema.slug, "missingProperty"),
				},
			}),
		);
		const mismatchedValueResult = await executeQueryEngine(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filter: {
					operator: "eq",
					type: "comparison",
					right: literalExpression("2020"),
					left: schemaPropertyExpression(schema.slug, "year"),
				},
			}),
		);

		expect(missingSchemaResult.response.status).toBe(404);
		expect(missingSchemaResult.error?.error?.message).toBe(
			"Schema 'missing-schema' not found",
		);
		expect(missingPropertyResult.response.status).toBe(400);
		expect(missingPropertyResult.error?.error?.message).toBe(
			`Property 'missingProperty' not found in schema '${schema.slug}'`,
		);
		expect(mismatchedValueResult.response.status).toBe(400);
		expect(mismatchedValueResult.error?.error?.message).toBe(
			"Filter operator 'eq' requires compatible expression types, received 'integer' and 'string'",
		);
	});
}
