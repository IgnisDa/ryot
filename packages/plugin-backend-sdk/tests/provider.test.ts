import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	defineProvider,
	providerDetailsResultSchema,
	providerRelatedInputSchema,
	providerRelatedResultSchema,
	providerResolveResultSchema,
	providerSearchInputSchema,
	providerSearchOptionsInputSchema,
	providerSearchOptionsResultSchema,
	providerSearchResultSchema,
	providerTranslateResultSchema,
} from "@ryot-app/plugin-backend-sdk/provider";

import { defineManifest, SANDBOX_SCRIPT_DEFINITION } from "../src/driver";

const manifest = defineManifest({ kind: "provider", name: "Test provider", slug: "test.provider" });

describe("provider definitions", () => {
	it.effect("requires and preserves the canonical name in translation input", () =>
		Effect.gen(function* () {
			const definition = defineProvider({
				manifest,
				operation: "translate",
				run: (input) => Effect.succeed({ name: input.name }),
			});
			const input = {
				properties: {},
				language: "es",
				externalId: "record-1",
				name: " Canonical record ",
				entitySchemaSlug: "record",
			};
			expect(yield* Schema.decodeEffect(definition.input)(input)).toEqual(input);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(definition.input)({
					properties: {},
					language: "es",
					externalId: "record-1",
					entitySchemaSlug: "record",
				}),
			);
		}),
	);
	it.effect("selects standard schemas for a provider operation", () =>
		Effect.gen(function* () {
			const definition = defineProvider({
				manifest,
				operation: "resolve",
				run: (input) =>
					Effect.succeed({ externalId: input.value === "known" ? "provider-1" : null }),
			});

			expect(definition.definitionType).toBe(SANDBOX_SCRIPT_DEFINITION);
			expect(definition.operation).toBe("resolve");
			expect(definition.output).toBe(providerResolveResultSchema);
			expect(
				yield* Schema.decodeEffect(definition.input)({ value: "known", identifierType: "isbn" }),
			).toEqual({ value: "known", identifierType: "isbn" });
		}),
	);

	it.effect("accepts optional JSON-object search options", () =>
		Effect.gen(function* () {
			expect(yield* Schema.decodeEffect(providerSearchInputSchema)({ query: "query" })).toEqual({
				page: 1,
				pageSize: 20,
				query: "query",
			});
			expect(
				yield* Schema.decodeEffect(providerSearchInputSchema)({
					query: "query",
					options: { passRawQuery: true, filters: { genreIds: ["5"] } },
				}),
			).toEqual({
				page: 1,
				pageSize: 20,
				query: "query",
				options: { passRawQuery: true, filters: { genreIds: ["5"] } },
			});
			yield* Effect.flip(Schema.decodeUnknownEffect(providerSearchInputSchema)({ options: [] }));
		}),
	);

	it.effect("supports the search-options provider operation", () =>
		Effect.gen(function* () {
			const definition = defineProvider({
				manifest,
				operation: "search-options",
				run: () =>
					Effect.succeed({ sources: { statuses: [{ value: "active", label: "Active" }] } }),
			});

			expect(definition.input).toBe(providerSearchOptionsInputSchema);
			expect(definition.output).toBe(providerSearchOptionsResultSchema);
			expect(yield* Schema.decodeEffect(definition.input)({})).toEqual({});
		}),
	);
});

describe("provider related pages", () => {
	const group = {
		entities: [],
		direction: "outgoing" as const,
		synchronization: "authoritative" as const,
		relationshipSchemaSlug: "company-to-record",
	};
	const details = (continuation: unknown) => ({
		properties: {},
		name: "Company",
		relatedEntityGroups: [{ ...group, continuation }],
	});

	it.effect("selects the related operation contract", () =>
		Effect.gen(function* () {
			const definition = defineProvider({
				manifest,
				operation: "related",
				run: () => Effect.succeed({ entities: [], continuation: null }),
			});

			expect(definition.input).toBe(providerRelatedInputSchema);
			expect(definition.output).toBe(providerRelatedResultSchema);
			expect(
				yield* Schema.decodeEffect(definition.input)({
					direction: "outgoing",
					externalId: " company-1 ",
					continuation: { page: 2 },
					relationshipSchemaSlug: "company-to-record",
				}),
			).toEqual({
				direction: "outgoing",
				externalId: "company-1",
				continuation: { page: 2 },
				relationshipSchemaSlug: "company-to-record",
			});
			expect(
				yield* Schema.decodeEffect(providerRelatedResultSchema)({
					entities: [],
					continuation: null,
				}),
			).toEqual({ entities: [], continuation: null });
			yield* Effect.flip(Schema.decodeUnknownEffect(providerRelatedResultSchema)({ entities: [] }));
		}),
	);

	it.effect("accepts a group continuation up to 4 KiB encoded and rejects larger ones", () =>
		Effect.gen(function* () {
			const fits = { cursor: "a".repeat(4 * 1024 - '{"cursor":""}'.length) };
			expect(
				yield* Schema.decodeUnknownEffect(providerDetailsResultSchema)(details(fits)),
			).toMatchObject({ relatedEntityGroups: [{ continuation: fits }] });
			expect(
				(yield* Effect.flip(
					Schema.decodeUnknownEffect(providerDetailsResultSchema)(
						details({ cursor: "a".repeat(4 * 1024) }),
					),
				)).message,
			).toContain("at most 4096 bytes");
			expect(
				(yield* Effect.flip(
					Schema.decodeEffect(providerRelatedResultSchema)({
						entities: [],
						continuation: { cursor: "a".repeat(4 * 1024) },
					}),
				)).message,
			).toContain("at most 4096 bytes");
			expect(
				(yield* Effect.flip(
					Schema.decodeEffect(providerRelatedInputSchema)({
						direction: "outgoing",
						externalId: "company-1",
						relationshipSchemaSlug: "company-to-record",
						continuation: { cursor: "a".repeat(4 * 1024) },
					}),
				)).message,
			).toContain("at most 4096 bytes");
		}),
	);
});

describe("provider result contracts", () => {
	it.effect("validates search, recursive details, resolve, and translation values", () =>
		Effect.gen(function* () {
			expect(
				yield* Schema.decodeEffect(providerSearchResultSchema)({
					items: [
						{
							title: " Show ",
							externalId: " show-1 ",
							metadata: [" 2024 ", 2024],
							imageUrl: " https://images.test/show.jpg ",
						},
					],
				}),
			).toEqual({
				items: [
					{
						title: "Show",
						externalId: "show-1",
						metadata: ["2024", 2024],
						imageUrl: "https://images.test/show.jpg",
					},
				],
			});
			yield* Effect.flip(
				Schema.decodeUnknownEffect(providerSearchResultSchema)({
					items: [{ metadata: [], title: "Show", externalId: "show-1" }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(providerSearchResultSchema)({
					items: [{ title: "Show", metadata: ["   "], externalId: "show-1" }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(providerSearchResultSchema)({
					items: [{ title: "Show", externalId: "show-1", metadata: [Number.NaN] }],
				}),
			);
			expect(
				yield* Schema.decodeEffect(providerSearchResultSchema)({
					items: [],
					details: { totalItems: 1, nextPage: null },
				}),
			).toEqual({ items: [], details: { totalItems: 1, nextPage: null } });
			yield* Effect.flip(
				Schema.decodeEffect(providerSearchResultSchema)({
					items: [],
					details: { nextPage: null, totalItems: Number.NaN },
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(providerSearchResultSchema)({
					items: [],
					details: { totalItems: 1, nextPage: Number.POSITIVE_INFINITY },
				}),
			);
			expect(
				yield* Schema.decodeEffect(providerDetailsResultSchema)({
					name: "Show",
					properties: { year: 2024 },
					expectedChildEntitySchemaSlug: "item-part",
					relatedEntityGroups: [
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "person-to-show",
							entities: [{ name: "Creator", externalId: "person-1", providerSlug: "person.test" }],
						},
					],
					childEntities: [
						{
							name: "Part 1",
							externalId: "part-1",
							properties: { number: 1 },
							entitySchemaSlug: "item-part",
							expectedChildEntitySchemaSlug: "item-subpart",
							childEntities: [
								{
									name: "Subpart 1",
									externalId: "subpart-1",
									properties: { number: 1 },
									entitySchemaSlug: "item-subpart",
								},
							],
						},
					],
				}),
			).toMatchObject({
				name: "Show",
				expectedChildEntitySchemaSlug: "item-part",
				childEntities: [{ expectedChildEntitySchemaSlug: "item-subpart" }],
			});
			expect(yield* Schema.decodeEffect(providerResolveResultSchema)({ externalId: null })).toEqual(
				{ externalId: null },
			);
			expect(
				yield* Schema.decodeEffect(providerTranslateResultSchema)({
					name: "Localized",
					properties: { description: "Translated" },
				}),
			).toEqual({ name: "Localized", properties: { description: "Translated" } });
		}),
	);
});
