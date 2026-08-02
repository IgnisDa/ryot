import type { RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { userLibraryRecipe } from "./user-library";

const userLibraryResponse = {
	data: {
		library: {
			type: "rows",
			pageInfo: { hasMore: false, limit: 2, nextCursor: null },
			items: [{ entityId: "library-1" }],
		},
	},
} satisfies RyotQLResponse;

describe("user library recipe", () => {
	it("builds a user library entity lookup", () => {
		const query = userLibraryRecipe().document.queries.library;
		if (query?.output.type !== "rows") {
			throw new Error("Expected a user library rows query");
		}

		expect(query.from).toEqual({ alias: "library", table: "entity" });
		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(query.where).toEqual({
			type: "and",
			predicates: [
				{
					operator: "eq",
					type: "comparison",
					right: { type: "literal", value: "library" },
					left: { type: "column", tableAlias: "library", field: "entitySchemaSlug" },
				},
				{
					type: "isNotNull",
					expr: { type: "column", tableAlias: "library", field: "userId" },
				},
			],
		});
		expect(query.output.fields).toEqual([
			{ key: "entityId", expr: { type: "column", tableAlias: "library", field: "id" } },
		]);
	});

	it("decodes the user library entity id", () => {
		expect(Result.getOrThrow(userLibraryRecipe().decode(userLibraryResponse))).toEqual({
			entityId: "library-1",
		});
	});

	it("rejects a malformed selected field", () => {
		const response = {
			data: {
				library: {
					...userLibraryResponse.data.library,
					items: [{ entityId: 1 }],
				},
			},
		};

		expect(Result.isFailure(userLibraryRecipe().decode(response))).toBe(true);
	});

	it("rejects a missing user library", () => {
		const response = { data: { library: { ...userLibraryResponse.data.library, items: [] } } };
		const decoded = userLibraryRecipe().decode(response);

		expect(Result.isFailure(decoded)).toBe(true);
		if (Result.isFailure(decoded)) {
			expect(decoded.failure).toEqual(new Error("RyotQL row query returned no rows"));
		}
	});
});
