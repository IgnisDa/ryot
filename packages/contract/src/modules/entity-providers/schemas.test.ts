import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
	ImportEntityBody,
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
} from "./schemas";

describe("provider entity boundary schemas", () => {
	it.effect("accepts the singular provider search request and response", () =>
		Effect.gen(function* () {
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

			expect(yield* Schema.decodeEffect(SearchProviderEntitiesBody)(body)).toEqual(body);
			expect(yield* Schema.decodeUnknownEffect(SearchProviderEntitiesResponse)(response)).toEqual(
				response,
			);
		}),
	);

	it.effect("rejects legacy and excess provider search fields", () =>
		Effect.gen(function* () {
			const body = { page: 1, pageSize: 20, query: "item", providerId: "provider_1" };
			const response = {
				items: [],
				providerName: "Items",
				providerId: "provider_1",
				rootEntitySchemaSlug: "item",
			};

			yield* Effect.flip(
				Schema.decodeUnknownEffect(SearchProviderEntitiesBody)({
					...body,
					savedViewSlug: "all-items",
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(SearchProviderEntitiesBody)({ ...body, options: [] }),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(SearchProviderEntitiesResponse)({
					...response,
					providers: [response],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(SearchProviderEntitiesResponse)({
					...response,
					entitySchemaSlug: "item",
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(SearchProviderEntitiesResponse)({
					...response,
					items: [{ metadata: [], title: "The Work", externalId: "item_1" }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(SearchProviderEntitiesResponse)({
					...response,
					items: [{ extraField: true, title: "The Work", externalId: "item_1" }],
				}),
			);
		}),
	);

	it.effect("accepts only the provider id and external id for imports", () =>
		Effect.gen(function* () {
			const body = { externalId: "item_1", providerId: "provider_1" };

			expect(yield* Schema.decodeEffect(ImportEntityBody)(body)).toEqual(body);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(ImportEntityBody)({ ...body, entitySchemaSlug: "item" }),
			);
		}),
	);
});
