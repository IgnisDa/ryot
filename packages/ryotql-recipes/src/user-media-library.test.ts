import type { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
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
	it("builds a user library entity lookup", () => {
		const query = userMediaLibraryRecipe().document.queries.mediaLibrary;
		if (query?.output.type !== "rows") {
			throw new Error("Expected a user library rows query");
		}

		expect(query.from).toEqual({ table: "entity", alias: "mediaLibrary" });
		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(query.where).toEqual({
			type: "and",
			predicates: [
				{
					operator: "eq",
					type: "comparison",
					right: { type: "literal", value: "media-library" },
					left: { type: "column", field: "entitySchemaSlug", tableAlias: "mediaLibrary" },
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
		expect(Result.getOrThrow(userMediaLibraryRecipe().decode(userMediaLibraryResponse))).toEqual({
			entityId: "library-1",
		});
	});

	it("rejects a malformed selected field", () => {
		const response = {
			data: {
				mediaLibrary: { ...userMediaLibraryResponse.data.mediaLibrary, items: [{ entityId: 1 }] },
			},
		};

		expect(Result.isFailure(userMediaLibraryRecipe().decode(response))).toBe(true);
	});

	it("rejects a missing user library", () => {
		const response = {
			data: { mediaLibrary: { ...userMediaLibraryResponse.data.mediaLibrary, items: [] } },
		};
		const decoded = userMediaLibraryRecipe().decode(response);

		expect(Result.isFailure(decoded)).toBe(true);
		if (Result.isFailure(decoded)) {
			expect(decoded.failure).toEqual(new Error("RyotQL row query returned no rows"));
		}
	});
});
