import { EntitySchemaSlug, PluginId } from "@ryot-app/contract/schema/brands";
import { Result } from "effect";
import { assert, describe, expect, it } from "vitest";

import { providerSearchRecipe } from "./provider-search";
import { rowsResponse } from "./test-utils";

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
const pageInfo = { limit: 100, hasMore: false, nextCursor: null };
const provider = {
	searchOptionsSchema,
	providerSlug: "provider",
	providerName: "Provider",
	providerId: "provider-1",
	rootEntitySchemaSlug: "entry",
};
const recipe = providerSearchRecipe({
	schema: {
		slug: EntitySchemaSlug.make("entry"),
		owner: { kind: "plugin", pluginId: PluginId.make("stable-plugin-id") },
	},
});
const responseWithItems = (items: readonly unknown[]) => rowsResponse("providers", items, pageInfo);

describe("provider search recipe", () => {
	it("prepares the active provider catalog and decodes plain values", () => {
		const query = recipe.document.queries.providers;
		assert(query);
		assert(query.output.type === "rows");

		expect(query.joins).toMatchObject([
			{ on: { left: { field: "id" }, right: { field: "providerId" } } },
			{ on: { right: { field: "id" }, left: { field: "pluginId" } } },
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
		expect(query.where).toMatchObject({
			predicates: [
				{ right: { value: "entry" } },
				{
					left: { field: "pluginId", tableAlias: "provider" },
					right: { type: "pluginId", reference: { kind: "local", pluginId: "stable-plugin-id" } },
				},
				{ right: { value: "search" } },
				{ right: { value: "active" } },
			],
		});
		expect(
			Result.getOrThrow(
				recipe.decode(
					responseWithItems([
						provider,
						{ ...provider, providerId: "provider-2", searchOptionsSchema: null },
					]),
				),
			),
		).toEqual({
			pageInfo,
			items: [provider, { ...provider, providerId: "provider-2", searchOptionsSchema: null }],
		});
	});

	it("rejects malformed option schemas and non-rows results", () => {
		expect(
			Result.isFailure(
				recipe.decode(
					responseWithItems([{ ...provider, searchOptionsSchema: { fields: { invalid: {} } } }]),
				),
			),
		).toBe(true);
		expect(
			Result.isFailure(recipe.decode({ data: { providers: { items: [], type: "aggregate" } } })),
		).toBe(true);
	});
});
