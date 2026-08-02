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
			query: "book",
			providerId: "provider_1",
			options: { passRawQuery: true },
		};
		const response = {
			providerName: "Books",
			providerId: "provider_1",
			rootEntitySchemaSlug: "book",
			details: { totalItems: 0, nextPage: null },
			items: [
				{
					title: "The Work",
					externalId: "book_1",
					metadata: ["Author", 2024],
					imageUrl: "https://images.test/book.jpg",
				},
			],
		};

		expect(Schema.decodeUnknownSync(SearchProviderEntitiesBody)(body)).toEqual(body);
		expect(Schema.decodeUnknownSync(SearchProviderEntitiesResponse)(response)).toEqual(response);
	});

	it("rejects legacy and excess provider search fields", () => {
		const body = { page: 1, pageSize: 20, query: "book", providerId: "provider_1" };
		const response = {
			items: [],
			providerName: "Books",
			providerId: "provider_1",
			rootEntitySchemaSlug: "book",
		};

		expect(() =>
			Schema.decodeUnknownSync(SearchProviderEntitiesBody)({ ...body, savedViewSlug: "all-books" }),
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
				entitySchemaSlug: "book",
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(SearchProviderEntitiesResponse)({
				...response,
				items: [{ metadata: [], title: "The Work", externalId: "book_1" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(SearchProviderEntitiesResponse)({
				...response,
				items: [{ extraField: true, title: "The Work", externalId: "book_1" }],
			}),
		).toThrow();
	});

	it("accepts only the provider id and external id for imports", () => {
		const body = { externalId: "book_1", providerId: "provider_1" };

		expect(Schema.decodeUnknownSync(ImportEntityBody)(body)).toEqual(body);
		expect(() =>
			Schema.decodeUnknownSync(ImportEntityBody)({ ...body, entitySchemaSlug: "book" }),
		).toThrow();
	});
});
