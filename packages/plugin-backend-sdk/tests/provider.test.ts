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
import { describe, expect, test } from "vitest";

import { defineManifest, SANDBOX_SCRIPT_DEFINITION } from "../src/driver";

const decode = <A, I>(schema: Schema.Codec<A, I>) => Schema.decodeUnknownSync(schema);
const manifest = defineManifest({ kind: "provider", name: "Test provider", slug: "test.provider" });

describe("provider definitions", () => {
	test("requires and preserves the canonical name in translation input", () => {
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
		expect(decode(definition.input)(input)).toEqual(input);
		expect(() =>
			decode(definition.input)({
				properties: {},
				language: "es",
				externalId: "record-1",
				entitySchemaSlug: "record",
			}),
		).toThrow();
	});
	test("selects standard schemas for a provider operation", () => {
		const definition = defineProvider({
			manifest,
			operation: "resolve",
			run: (input) => Effect.succeed({ externalId: input.value === "known" ? "provider-1" : null }),
		});

		expect(definition.definitionType).toBe(SANDBOX_SCRIPT_DEFINITION);
		expect(definition.operation).toBe("resolve");
		expect(definition.output).toBe(providerResolveResultSchema);
		expect(decode(definition.input)({ value: "known", identifierType: "isbn" })).toEqual({
			value: "known",
			identifierType: "isbn",
		});
	});

	test("accepts optional JSON-object search options", () => {
		expect(decode(providerSearchInputSchema)({ query: "query" })).toEqual({
			page: 1,
			pageSize: 20,
			query: "query",
		});
		expect(
			decode(providerSearchInputSchema)({
				query: "query",
				options: { passRawQuery: true, filters: { genreIds: ["5"] } },
			}),
		).toEqual({
			page: 1,
			pageSize: 20,
			query: "query",
			options: { passRawQuery: true, filters: { genreIds: ["5"] } },
		});
		expect(() => decode(providerSearchInputSchema)({ options: [] })).toThrow();
	});

	test("supports the search-options provider operation", () => {
		const definition = defineProvider({
			manifest,
			operation: "search-options",
			run: () => Effect.succeed({ sources: { statuses: [{ value: "active", label: "Active" }] } }),
		});

		expect(definition.input).toBe(providerSearchOptionsInputSchema);
		expect(definition.output).toBe(providerSearchOptionsResultSchema);
		expect(decode(definition.input)({})).toEqual({});
	});
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

	test("selects the related operation contract", () => {
		const definition = defineProvider({
			manifest,
			operation: "related",
			run: () => Effect.succeed({ entities: [], continuation: null }),
		});

		expect(definition.input).toBe(providerRelatedInputSchema);
		expect(definition.output).toBe(providerRelatedResultSchema);
		expect(
			decode(definition.input)({
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
		expect(decode(providerRelatedResultSchema)({ entities: [], continuation: null })).toEqual({
			entities: [],
			continuation: null,
		});
		expect(() => decode(providerRelatedResultSchema)({ entities: [] })).toThrow();
	});

	test("accepts a group continuation up to 4 KiB encoded and rejects larger ones", () => {
		const fits = { cursor: "a".repeat(4 * 1024 - '{"cursor":""}'.length) };
		expect(decode(providerDetailsResultSchema)(details(fits))).toMatchObject({
			relatedEntityGroups: [{ continuation: fits }],
		});
		expect(() =>
			decode(providerDetailsResultSchema)(details({ cursor: "a".repeat(4 * 1024) })),
		).toThrow("at most 4096 bytes");
		expect(() =>
			decode(providerRelatedResultSchema)({
				entities: [],
				continuation: { cursor: "a".repeat(4 * 1024) },
			}),
		).toThrow("at most 4096 bytes");
		expect(() =>
			decode(providerRelatedInputSchema)({
				direction: "outgoing",
				externalId: "company-1",
				relationshipSchemaSlug: "company-to-record",
				continuation: { cursor: "a".repeat(4 * 1024) },
			}),
		).toThrow("at most 4096 bytes");
	});
});

describe("provider result contracts", () => {
	test("validates search, recursive details, resolve, and translation values", () => {
		expect(
			decode(providerSearchResultSchema)({
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
		expect(() =>
			decode(providerSearchResultSchema)({
				items: [{ metadata: [], title: "Show", externalId: "show-1" }],
			}),
		).toThrow();
		expect(() =>
			decode(providerSearchResultSchema)({
				items: [{ title: "Show", metadata: ["   "], externalId: "show-1" }],
			}),
		).toThrow();
		expect(() =>
			decode(providerSearchResultSchema)({
				items: [{ title: "Show", externalId: "show-1", metadata: [Number.NaN] }],
			}),
		).toThrow();
		expect(
			decode(providerSearchResultSchema)({ items: [], details: { totalItems: 1, nextPage: null } }),
		).toEqual({ items: [], details: { totalItems: 1, nextPage: null } });
		expect(() =>
			decode(providerSearchResultSchema)({
				items: [],
				details: { nextPage: null, totalItems: Number.NaN },
			}),
		).toThrow();
		expect(() =>
			decode(providerSearchResultSchema)({
				items: [],
				details: { totalItems: 1, nextPage: Number.POSITIVE_INFINITY },
			}),
		).toThrow();
		expect(
			decode(providerDetailsResultSchema)({
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
		expect(decode(providerResolveResultSchema)({ externalId: null })).toEqual({ externalId: null });
		expect(
			decode(providerTranslateResultSchema)({
				name: "Localized",
				properties: { description: "Translated" },
			}),
		).toEqual({ name: "Localized", properties: { description: "Translated" } });
	});
});
