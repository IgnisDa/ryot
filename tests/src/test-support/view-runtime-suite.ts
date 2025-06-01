import { expect, it } from "bun:test";
import {
	buildGridDisplayConfiguration,
	buildGridRequest,
	buildListRequest,
	buildTableDisplayConfiguration,
	buildTableRequest,
	createCrossSchemaRuntimeFixture,
	createSingleSchemaRuntimeFixture,
	executeViewRuntime,
} from "./view-runtime";

export function registerViewRuntimePresentationAndErrorTests() {
	it("returns semantic keys for grid and list layouts with raw image unions", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const expectedProperties = {
			badgeProperty: "phone",
			subtitleProperty: 2018,
			titleProperty: "Alpha Phone",
			imageProperty: {
				kind: "remote",
				url: "https://example.com/alpha-phone.png",
			},
		};

		const gridResult = await executeViewRuntime(
			client,
			cookies,
			buildGridRequest({
				page: { limit: 1, offset: 0 },
				entitySchemaSlugs: [schema.slug],
			}),
		);
		const listResult = await executeViewRuntime(
			client,
			cookies,
			buildListRequest({
				page: { limit: 1, offset: 0 },
				entitySchemaSlugs: [schema.slug],
			}),
		);

		expect(gridResult.response.status).toBe(200);
		expect(listResult.response.status).toBe(200);
		expect(gridResult.data?.data.items[0]?.resolvedProperties).toEqual(
			expectedProperties,
		);
		expect(listResult.data?.data.items[0]?.resolvedProperties).toEqual(
			expectedProperties,
		);
		expect(gridResult.data?.data.items[0]?.image).toEqual(
			expectedProperties.imageProperty,
		);
	});

	it("returns index-based table columns and nulls for empty property references", async () => {
		const { client, cookies, schema } =
			await createSingleSchemaRuntimeFixture();
		const { data, response } = await executeViewRuntime(
			client,
			cookies,
			buildTableRequest({
				page: { limit: 1, offset: 0 },
				entitySchemaSlugs: [schema.slug],
				displayConfiguration: buildTableDisplayConfiguration([
					{ property: ["@name"] },
					{ property: ["year"] },
					{ property: [] },
				]),
			}),
		);

		expect(response.status).toBe(200);
		expect(data?.data.items[0]?.resolvedProperties).toEqual({
			column_0: "Alpha Phone",
			column_1: 2018,
			column_2: null,
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
					field: [`${smartphoneSlug}.year`, `${tabletSlug}.releaseYear`],
					direction: "asc",
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
		expect(data?.data.items[0]?.resolvedProperties).toEqual({
			badgeProperty: 2018,
			subtitleProperty: "Acme",
			titleProperty: "Alpha Phone",
			imageProperty: {
				kind: "remote",
				url: "https://example.com/alpha-phone.png",
			},
		});
		expect(data?.data.items[1]?.resolvedProperties).toEqual({
			badgeProperty: 2019,
			subtitleProperty: "Tabula",
			titleProperty: "Beta Tablet",
			imageProperty: {
				kind: "remote",
				url: "https://example.com/beta-tablet.png",
			},
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
				filters: [{ op: "eq", field: ["missingProperty"], value: "phone" }],
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
	});
}
