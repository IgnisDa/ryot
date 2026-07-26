import type { RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import { EntitySchemaSlug } from "@ryot/contract/schema/brands";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { buildProviderSearchDocument, decodeProviderSearchResponse } from "./provider-search";

const searchOptionsSchema = {
	unknownKeys: "strict",
	fields: {
		includeArchived: {
			type: "boolean",
			label: "Include archived",
			description: "Include archived records",
		},
	},
} as const;

const providerSearchResponse = {
	data: {
		providers: {
			type: "rows",
			pageInfo: { hasMore: false, limit: 100, nextCursor: null },
			items: [
				{
					providerSlug: { kind: "text", value: "tmdb" },
					providerName: { kind: "text", value: "TMDB" },
					providerId: { kind: "text", value: "provider-1" },
					rootEntitySchemaSlug: { kind: "text", value: "movie" },
					searchOptionsSchema: { kind: "json", value: searchOptionsSchema },
				},
				{
					providerId: { kind: "text", value: "provider-2" },
					searchOptionsSchema: { kind: "null", value: null },
					providerSlug: { kind: "text", value: "open-library" },
					providerName: { kind: "text", value: "Open Library" },
					rootEntitySchemaSlug: { kind: "text", value: "movie" },
				},
			],
		},
	},
} satisfies RyotQLResponse;

describe("provider search recipe", () => {
	it("builds the active search-provider catalog query", () => {
		const query = buildProviderSearchDocument({
			rootEntitySchemaSlug: EntitySchemaSlug.make("movie"),
		}).queries.providers;

		expect(query.from).toEqual({ alias: "provider", table: "sandboxProvider" });
		expect(query.joins).toEqual([
			{
				type: "inner",
				table: { alias: "operation", table: "sandboxProviderOperation" },
				on: {
					operator: "eq",
					type: "comparison",
					left: { type: "column", tableAlias: "provider", field: "id" },
					right: { type: "column", tableAlias: "operation", field: "providerId" },
				},
			},
			{
				type: "inner",
				table: { alias: "plugin", table: "plugin" },
				on: {
					operator: "eq",
					type: "comparison",
					right: { type: "column", tableAlias: "plugin", field: "slug" },
					left: { type: "column", tableAlias: "provider", field: "pluginSlug" },
				},
			},
		]);
		expect(query.where).toEqual({
			type: "and",
			predicates: [
				{
					operator: "eq",
					type: "comparison",
					right: { type: "literal", value: "movie" },
					left: { type: "column", tableAlias: "provider", field: "rootEntitySchemaSlug" },
				},
				{
					operator: "eq",
					type: "comparison",
					right: { type: "literal", value: "search" },
					left: { type: "column", tableAlias: "operation", field: "operation" },
				},
				{
					operator: "eq",
					type: "comparison",
					right: { type: "literal", value: "active" },
					left: { type: "column", tableAlias: "plugin", field: "status" },
				},
			],
		});
		expect(query.output.orderBy).toEqual([
			{ direction: "asc", expr: { type: "column", tableAlias: "provider", field: "name" } },
			{ direction: "asc", expr: { type: "column", tableAlias: "provider", field: "slug" } },
			{ direction: "asc", expr: { type: "column", tableAlias: "provider", field: "id" } },
		]);
		expect(
			query.output.fields.map((selection) => ("key" in selection ? selection.key : null)),
		).toEqual([
			"providerId",
			"providerSlug",
			"providerName",
			"rootEntitySchemaSlug",
			"searchOptionsSchema",
		]);
	});

	it("decodes canonical option schemas and JSON null as null", () => {
		expect(Result.getOrThrow(decodeProviderSearchResponse(providerSearchResponse))).toEqual({
			pageInfo: { hasMore: false, limit: 100, nextCursor: null },
			items: [
				{
					searchOptionsSchema,
					providerSlug: "tmdb",
					providerName: "TMDB",
					providerId: "provider-1",
					rootEntitySchemaSlug: "movie",
				},
				{
					providerId: "provider-2",
					searchOptionsSchema: null,
					providerSlug: "open-library",
					providerName: "Open Library",
					rootEntitySchemaSlug: "movie",
				},
			],
		});
	});

	it("rejects a non-AppSchema options value", () => {
		expect(
			Result.isFailure(
				decodeProviderSearchResponse({
					...providerSearchResponse,
					data: {
						...providerSearchResponse.data,
						providers: {
							...providerSearchResponse.data.providers,
							items: [
								{
									...providerSearchResponse.data.providers.items[0],
									searchOptionsSchema: { kind: "json", value: { fields: { invalid: {} } } },
								},
							],
						},
					},
				}),
			),
		).toBe(true);
	});
});
