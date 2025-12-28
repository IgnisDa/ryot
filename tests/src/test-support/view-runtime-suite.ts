import { expect, it } from "bun:test";
import {
	buildGridDisplayConfiguration,
	buildGridRequest,
	buildListRequest,
	buildTableDisplayConfiguration,
	buildTableRequest,
	createAuthenticatedClient,
	createCrossSchemaRuntimeFixture,
	createEntitySchema,
	createEventSchema,
	createRuntimeEntity,
	createRuntimeEvent,
	createSingleSchemaRuntimeFixture,
	createTracker,
	executeViewRuntime,
} from "src/fixtures";

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

type ViewRuntimeItem = NonNullable<
	Awaited<ReturnType<typeof executeViewRuntime>>["data"]
>["data"]["items"][number];

const getField = (item: ViewRuntimeItem | undefined, key: string) => {
	expect(item).toBeDefined();
	const field = item?.fields.find((entry) => entry.key === key);
	expect(field).toBeDefined();
	if (!field) {
		throw new Error(`Expected runtime field '${key}'`);
	}

	return field;
};

async function createImageFallbackFixture() {
	const { client, cookies } = await createAuthenticatedClient();
	const { trackerId } = await createTracker(client, cookies, {
		name: "Fallback Image Tracker",
	});
	const schema = await createEntitySchema(client, cookies, {
		trackerId,
		name: "Fallback Image Device",
		propertiesSchema: { fields: { category: { type: "string" } } },
	});

	await createRuntimeEntity({
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
		await createSingleSchemaRuntimeFixture();
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
			fields: { note: { type: "string" }, rating: { type: "number" } },
		},
	});

	await createRuntimeEvent({
		client,
		cookies,
		entityId: alphaPhoneId,
		eventSchemaId: reviewSchema.id,
		properties: { rating: 2, note: "draft" },
	});
	await createRuntimeEvent({
		client,
		cookies,
		entityId: alphaPhoneId,
		eventSchemaId: reviewSchema.id,
		properties: { rating: 5, note: "final" },
	});
	await createRuntimeEvent({
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
	} = await createCrossSchemaRuntimeFixture();
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
		propertiesSchema: { fields: { rating: { type: "number" } } },
	});

	await createRuntimeEvent({
		client,
		cookies,
		entityId: alphaPhoneId,
		properties: { rating: 5 },
		eventSchemaId: reviewSchema.id,
	});
	await createRuntimeEvent({
		client,
		cookies,
		entityId: gammaPhoneId,
		properties: { rating: 4 },
		eventSchemaId: reviewSchema.id,
	});

	return { client, cookies, smartphoneSlug, tabletSlug };
}

export function registerViewRuntimePresentationAndErrorTests() {
	it("returns semantic keys for grid and list layouts with raw image unions", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();

		const gridResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 1, limit: 1 },
			}),
		);
		const listResult = await executeViewRuntime(
			client,
			cookies,
			buildListRequest({
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 1, limit: 1 },
			}),
		);

		expect(gridResult.response.status).toBe(200);
		expect(listResult.response.status).toBe(200);
		expect(getField(gridResult.data?.data.items[0], "badge")).toEqual({
			key: "badge",
			kind: "text",
			value: "phone",
		});
		expect(getField(gridResult.data?.data.items[0], "subtitle")).toEqual({
			key: "subtitle",
			kind: "number",
			value: 2018,
		});
		expect(getField(gridResult.data?.data.items[0], "title")).toEqual({
			key: "title",
			kind: "text",
			value: "Alpha Phone",
		});
		expect(getField(gridResult.data?.data.items[0], "image")).toEqual({
			key: "image",
			kind: "image",
			value: { kind: "remote", url: "https://example.com/alpha-phone.png" },
		});
		expect(getField(listResult.data?.data.items[0], "badge")).toEqual({
			key: "badge",
			kind: "text",
			value: "phone",
		});
		expect(getField(listResult.data?.data.items[0], "subtitle")).toEqual({
			key: "subtitle",
			kind: "number",
			value: 2018,
		});
		expect(getField(listResult.data?.data.items[0], "title")).toEqual({
			key: "title",
			kind: "text",
			value: "Alpha Phone",
		});
		expect(getField(listResult.data?.data.items[0], "image")).toEqual({
			key: "image",
			kind: "image",
			value: { kind: "remote", url: "https://example.com/alpha-phone.png" },
		});
		expect(gridResult.data?.data.items[0]?.image).toEqual(
			getField(gridResult.data?.data.items[0], "image").value,
		);
	});

	it("returns null wrappers for empty grid display references", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const { data, response } = await executeViewRuntime(
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
		expect(getField(data?.data.items[0], "badge")).toEqual({
			key: "badge",
			kind: "null",
			value: null,
		});
		expect(getField(data?.data.items[0], "subtitle")).toEqual({
			key: "subtitle",
			kind: "null",
			value: null,
		});
		expect(getField(data?.data.items[0], "title")).toEqual({
			key: "title",
			kind: "text",
			value: "Alpha Phone",
		});
		expect(getField(data?.data.items[0], "image")).toEqual({
			key: "image",
			kind: "image",
			value: { kind: "remote", url: "https://example.com/alpha-phone.png" },
		});
	});

	it("returns ordered table fields and null wrappers for empty property references", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const { data, response } = await executeViewRuntime(
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
			await createCrossSchemaRuntimeFixture();
		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				sort: {
					direction: "asc",
					fields: [
						entityField(smartphoneSlug, "year"),
						entityField(tabletSlug, "releaseYear"),
					],
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
		expect(getField(data?.data.items[0], "badge")).toEqual({
			key: "badge",
			kind: "number",
			value: 2018,
		});
		expect(getField(data?.data.items[0], "subtitle")).toEqual({
			key: "subtitle",
			kind: "text",
			value: "Acme",
		});
		expect(getField(data?.data.items[1], "badge")).toEqual({
			key: "badge",
			kind: "number",
			value: 2019,
		});
		expect(getField(data?.data.items[1], "subtitle")).toEqual({
			key: "subtitle",
			kind: "text",
			value: "Tabula",
		});
	});

	it("falls through to later image references when @image is null", async () => {
		const { client, cookies, schema } = await createImageFallbackFixture();

		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [
					{
						op: "eq",
						value: "No Image Device",
						field: entityField(schema.slug, "name"),
					},
				],
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

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.image).toBeNull();
		expect(getField(data?.data.items[0], "badge")).toEqual({
			key: "badge",
			kind: "null",
			value: null,
		});
		expect(getField(data?.data.items[0], "subtitle")).toEqual({
			key: "subtitle",
			kind: "null",
			value: null,
		});
		expect(getField(data?.data.items[0], "image")).toEqual({
			key: "image",
			kind: "text",
			value: "fallback-image",
		});
		expect(getField(data?.data.items[0], "title")).toEqual({
			key: "title",
			kind: "text",
			value: "No Image Device",
		});
	});

	it("falls through to later image references in list layout when @image is null", async () => {
		const { client, cookies, schema } = await createImageFallbackFixture();

		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildListRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [
					{
						op: "eq",
						value: "No Image Device",
						field: entityField(schema.slug, "name"),
					},
				],
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

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.image).toBeNull();
		expect(getField(data?.data.items[0], "badge")).toEqual({
			key: "badge",
			kind: "null",
			value: null,
		});
		expect(getField(data?.data.items[0], "subtitle")).toEqual({
			key: "subtitle",
			kind: "null",
			value: null,
		});
		expect(getField(data?.data.items[0], "image")).toEqual({
			key: "image",
			kind: "text",
			value: "fallback-image",
		});
		expect(getField(data?.data.items[0], "title")).toEqual({
			key: "title",
			kind: "text",
			value: "No Image Device",
		});
	});

	it("falls through to later image references in table fields when @image is null", async () => {
		const { client, cookies, schema } = await createImageFallbackFixture();

		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildTableRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [
					{
						op: "eq",
						value: "No Image Device",
						field: entityField(schema.slug, "name"),
					},
				],
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

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.image).toBeNull();
		expect(data?.data.items[0]?.fields).toEqual([
			{ key: "column_0", kind: "text", value: "fallback-image" },
			{ key: "column_1", kind: "text", value: "No Image Device" },
		]);
	});

	it("filters, sorts, and displays latest-event join data", async () => {
		const { client, cookies, schema } = await createLatestEventJoinFixture();
		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildTableRequest({
				entitySchemaSlugs: [schema.slug],
				sort: { fields: ["event.review.rating"], direction: "desc" },
				filters: [{ op: "gte", field: "event.review.rating", value: 4 }],
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
		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				filters: [{ op: "isNull", field: "event.review.rating" }],
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
			expect(getField(item, "badge")).toEqual({
				key: "badge",
				kind: "null",
				value: null,
			});
		}
	});

	it("returns only entities with a non-null event join value for isNotNull", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createMixedLatestEventJoinFixture();
		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [smartphoneSlug, tabletSlug],
				filters: [{ op: "isNotNull", field: "event.review.rating" }],
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
			expect(getField(item, "badge").kind).toBe("number");
		}
	});

	it("returns 404 and 400 errors for invalid runtime requests", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const missingSchemaResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({ entitySchemaSlugs: ["missing-schema"] }),
		);
		const missingPropertyResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [
					{
						op: "eq",
						value: "phone",
						field: entityField(schema.slug, "missingProperty"),
					},
				],
			}),
		);
		const mismatchedValueResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [
					{ op: "eq", field: entityField(schema.slug, "year"), value: "2020" },
				],
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
			`Filter value for '${entityField(schema.slug, "year")}' must match the 'integer' property type`,
		);
	});
}
