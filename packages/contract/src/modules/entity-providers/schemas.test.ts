import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	ImportEntityBody,
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
} from "./schemas";

describe("provider entity boundary schemas", () => {
	it("accepts the singular provider search request and response", () => {
		const body = {
			page: 1,
			pageSize: 20,
			query: "item",
			providerId: "provider_1",
			options: { passRawQuery: true },
		};
		const response = {
			providerName: "Items",
			providerId: "provider_1",
			rootEntitySchemaSlug: "item",
			details: { totalItems: 0, nextPage: null },
			items: [
				{
					title: "The Work",
					externalId: "item_1",
					metadata: ["Author", 2024],
					imageUrl: "https://images.test/item.jpg",
				},
			],
		};

		expect(Schema.decodeSync(SearchProviderEntitiesBody)(body)).toEqual(body);
		expect(Schema.decodeUnknownSync(SearchProviderEntitiesResponse)(response)).toEqual(response);
	});

	it("rejects legacy and excess provider search fields", () => {
		const body = { page: 1, pageSize: 20, query: "item", providerId: "provider_1" };
		const response = {
			items: [],
			providerName: "Items",
			providerId: "provider_1",
			rootEntitySchemaSlug: "item",
		};

		expect(() =>
			Schema.decodeUnknownSync(SearchProviderEntitiesBody)({ ...body, savedViewSlug: "all-items" }),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(SearchProviderEntitiesBody)({ ...body, options: [] }),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(SearchProviderEntitiesResponse)({
				...response,
				providers: [response],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(SearchProviderEntitiesResponse)({
				...response,
				entitySchemaSlug: "item",
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(SearchProviderEntitiesResponse)({
				...response,
				items: [{ metadata: [], title: "The Work", externalId: "item_1" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(SearchProviderEntitiesResponse)({
				...response,
				items: [{ extraField: true, title: "The Work", externalId: "item_1" }],
			}),
		).toThrow();
	});

	it("accepts only the provider id and external id for imports", () => {
		const body = { externalId: "item_1", providerId: "provider_1" };

		expect(Schema.decodeSync(ImportEntityBody)(body)).toEqual(body);
		expect(() =>
			Schema.decodeUnknownSync(ImportEntityBody)({ ...body, entitySchemaSlug: "item" }),
		).toThrow();
	});
});
