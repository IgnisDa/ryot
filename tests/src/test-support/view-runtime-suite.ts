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
	createRuntimeEntity,
	createSingleSchemaRuntimeFixture,
	createTracker,
	executeViewRuntime,
} from "src/fixtures";

type ViewRuntimeItem = NonNullable<
	Awaited<ReturnType<typeof executeViewRuntime>>["data"]
>["data"]["items"][number];
type ViewRuntimeResponseData = NonNullable<
	Awaited<ReturnType<typeof executeViewRuntime>>["data"]
>["data"];

const getSemanticItem = (item: ViewRuntimeItem | undefined) => {
	expect(item && "resolvedProperties" in item).toBe(true);
	if (!item || !("resolvedProperties" in item)) {
		throw new Error("Expected grid/list runtime item");
	}

	return item;
};

const getTableItem = (item: ViewRuntimeItem | undefined) => {
	expect(item && "cells" in item).toBe(true);
	if (!item || !("cells" in item)) {
		throw new Error("Expected table runtime item");
	}

	return item;
};

const getTableMeta = (data: ViewRuntimeResponseData) => {
	expect("table" in data.meta).toBe(true);
	if (!("table" in data.meta)) {
		throw new Error("Expected table runtime metadata");
	}

	return data.meta.table;
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

export function registerViewRuntimePresentationAndErrorTests() {
	it("returns semantic keys for grid and list layouts with raw image unions", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const expectedProperties = {
			badgeProperty: { kind: "text", value: "phone" },
			subtitleProperty: { kind: "number", value: 2018 },
			titleProperty: { kind: "text", value: "Alpha Phone" },
			imageProperty: {
				kind: "image",
				value: { kind: "remote", url: "https://example.com/alpha-phone.png" },
			},
		} as const;

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
		expect(
			getSemanticItem(gridResult.data?.data.items[0]).resolvedProperties,
		).toEqual(expectedProperties);
		expect(
			getSemanticItem(listResult.data?.data.items[0]).resolvedProperties,
		).toEqual(expectedProperties);
		expect(gridResult.data?.data.items[0]?.image).toEqual(
			expectedProperties.imageProperty.value,
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
				displayConfiguration: buildGridDisplayConfiguration({
					badgeProperty: [],
					subtitleProperty: [],
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(getSemanticItem(data?.data.items[0]).resolvedProperties).toEqual({
			badgeProperty: { kind: "null", value: null },
			subtitleProperty: { kind: "null", value: null },
			titleProperty: { kind: "text", value: "Alpha Phone" },
			imageProperty: {
				kind: "image",
				value: { kind: "remote", url: "https://example.com/alpha-phone.png" },
			},
		});
	});

	it("returns table metadata, ordered cells, and null wrappers for empty property references", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildTableRequest({
				entitySchemaSlugs: [schema.slug],
				pagination: { page: 1, limit: 1 },
				displayConfiguration: buildTableDisplayConfiguration([
					{ label: "Name", property: ["@name"] },
					{ label: "Year", property: [`${schema.slug}.year`] },
					{ label: "Empty", property: [] },
				]),
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data && getTableMeta(data.data)).toEqual({
			columns: [
				{ key: "column_0", label: "Name" },
				{ key: "column_1", label: "Year" },
				{ key: "column_2", label: "Empty" },
			],
		});
		expect(getTableItem(data?.data.items[0])).toMatchObject({
			cells: [
				{ key: "column_0", kind: "text", value: "Alpha Phone" },
				{ key: "column_1", kind: "number", value: 2018 },
				{ key: "column_2", kind: "null", value: null },
			],
		});
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
					fields: [`${smartphoneSlug}.year`, `${tabletSlug}.releaseYear`],
				},
				displayConfiguration: buildGridDisplayConfiguration({
					badgeProperty: [
						`${smartphoneSlug}.year`,
						`${tabletSlug}.releaseYear`,
					],
					subtitleProperty: [
						`${smartphoneSlug}.manufacturer`,
						`${tabletSlug}.maker`,
					],
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(getSemanticItem(data?.data.items[0]).resolvedProperties).toEqual({
			badgeProperty: { kind: "number", value: 2018 },
			subtitleProperty: { kind: "text", value: "Acme" },
			titleProperty: { kind: "text", value: "Alpha Phone" },
			imageProperty: {
				kind: "image",
				value: { kind: "remote", url: "https://example.com/alpha-phone.png" },
			},
		});
		expect(getSemanticItem(data?.data.items[1]).resolvedProperties).toEqual({
			badgeProperty: { kind: "number", value: 2019 },
			subtitleProperty: { kind: "text", value: "Tabula" },
			titleProperty: { kind: "text", value: "Beta Tablet" },
			imageProperty: {
				kind: "image",
				value: { kind: "remote", url: "https://example.com/beta-tablet.png" },
			},
		});
	});

	it("falls through to later image references when @image is null", async () => {
		const { client, cookies, schema } = await createImageFallbackFixture();

		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [{ op: "eq", field: "@name", value: "No Image Device" }],
				displayConfiguration: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
					imageProperty: ["@image", `${schema.slug}.category`],
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.image).toBeNull();
		expect(getSemanticItem(data?.data.items[0]).resolvedProperties).toEqual({
			badgeProperty: { kind: "null", value: null },
			subtitleProperty: { kind: "null", value: null },
			imageProperty: { kind: "text", value: "fallback-image" },
			titleProperty: { kind: "text", value: "No Image Device" },
		});
	});

	it("falls through to later image references in list layout when @image is null", async () => {
		const { client, cookies, schema } = await createImageFallbackFixture();

		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildListRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [{ op: "eq", field: "@name", value: "No Image Device" }],
				displayConfiguration: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
					imageProperty: ["@image", `${schema.slug}.category`],
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.image).toBeNull();
		expect(getSemanticItem(data?.data.items[0]).resolvedProperties).toEqual({
			badgeProperty: { kind: "null", value: null },
			subtitleProperty: { kind: "null", value: null },
			imageProperty: { kind: "text", value: "fallback-image" },
			titleProperty: { kind: "text", value: "No Image Device" },
		});
	});

	it("falls through to later image references in table layout when @image is null", async () => {
		const { client, cookies, schema } = await createImageFallbackFixture();

		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildTableRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [{ op: "eq", field: "@name", value: "No Image Device" }],
				displayConfiguration: buildTableDisplayConfiguration([
					{ label: "Image", property: ["@image", `${schema.slug}.category`] },
					{ label: "Name", property: ["@name"] },
				]),
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.image).toBeNull();
		expect(data?.data && getTableMeta(data.data)).toEqual({
			columns: [
				{ key: "column_0", label: "Image" },
				{ key: "column_1", label: "Name" },
			],
		});
		expect(getTableItem(data?.data.items[0])).toMatchObject({
			cells: [
				{ key: "column_0", kind: "text", value: "fallback-image" },
				{ key: "column_1", kind: "text", value: "No Image Device" },
			],
		});
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
					{ op: "eq", field: `${schema.slug}.missingProperty`, value: "phone" },
				],
			}),
		);
		const mismatchedValueResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				entitySchemaSlugs: [schema.slug],
				filters: [{ op: "eq", field: `${schema.slug}.year`, value: "2020" }],
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
			`Filter value for '${schema.slug}.year' must match the 'integer' property type`,
		);
	});
}
