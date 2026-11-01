import type { PluginPackageReference } from "@ryot-app/contract/modules/plugins/references";
import type { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { userMediaLibraryRecipe } from "./user-media-library";

const userMediaLibraryResponse = {
	data: {
		mediaLibrary: {
			type: "rows",
			items: [{ entityId: "library-1" }],
			pageInfo: { limit: 2, hasMore: false, nextCursor: null },
		},
	},
} satisfies RyotQLResponse;

describe("user media library recipe", () => {
	it.each(["system", "user"] satisfies readonly PluginPackageReference["scope"][])(
		"keeps the explicit %s package scope in the library query",
		(scope) => {
			const packageId = PluginPackageId.make("test/library");
			const query = userMediaLibraryRecipe({ scope, packageId, kind: "package" }).document.queries
				.mediaLibrary;
			expect(query?.where).toMatchObject({
				predicates: [
					{
						predicates: [
							{ right: { value: "media-library" }, left: { field: "entitySchemaSlug" } },
							{
								left: { field: "entitySchemaPluginId" },
								right: { type: "pluginId", reference: { scope, packageId, kind: "package" } },
							},
						],
					},
					{ type: "isNotNull", expr: { field: "userId" } },
				],
			});
		},
	);
	it("builds a user library entity lookup", () => {
		const query = userMediaLibraryRecipe({ kind: "self" }).document.queries.mediaLibrary;
		if (query?.output.type !== "rows") {
			throw new Error("Expected a user library rows query");
		}

		expect(query.from).toEqual({ table: "entity", alias: "mediaLibrary" });
		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(query.where).toEqual({
			type: "and",
			predicates: [
				{
					type: "and",
					predicates: [
						{
							operator: "eq",
							type: "comparison",
							right: { type: "literal", value: "media-library" },
							left: { type: "column", field: "entitySchemaSlug", tableAlias: "mediaLibrary" },
						},
						{
							operator: "eq",
							type: "comparison",
							right: { type: "pluginId", reference: { kind: "self" } },
							left: { type: "column", tableAlias: "mediaLibrary", field: "entitySchemaPluginId" },
						},
					],
				},
				{
					type: "isNotNull",
					expr: { type: "column", field: "userId", tableAlias: "mediaLibrary" },
				},
			],
		});
		expect(query.output.fields).toEqual([
			{ key: "entityId", expr: { field: "id", type: "column", tableAlias: "mediaLibrary" } },
		]);
	});

	it("decodes the user library entity id", () => {
		expect(
			Result.getOrThrow(userMediaLibraryRecipe({ kind: "self" }).decode(userMediaLibraryResponse)),
		).toEqual({ entityId: "library-1" });
	});

	it("rejects a malformed selected field", () => {
		const response = {
			data: {
				mediaLibrary: { ...userMediaLibraryResponse.data.mediaLibrary, items: [{ entityId: 1 }] },
			},
		};

		expect(Result.isFailure(userMediaLibraryRecipe({ kind: "self" }).decode(response))).toBe(true);
	});

	it("rejects a missing user library", () => {
		const response = {
			data: { mediaLibrary: { ...userMediaLibraryResponse.data.mediaLibrary, items: [] } },
		};
		const decoded = userMediaLibraryRecipe({ kind: "self" }).decode(response);

		expect(Result.isFailure(decoded)).toBe(true);
		if (Result.isFailure(decoded)) {
			expect(decoded.failure).toEqual(new Error("RyotQL row query returned no rows"));
		}
	});
});
