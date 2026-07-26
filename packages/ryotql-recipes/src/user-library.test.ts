import type { RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { buildUserLibraryDocument, decodeUserLibraryResponse } from "./user-library";

const userLibraryResponse = {
	data: {
		library: {
			type: "rows",
			pageInfo: { hasMore: false, limit: 1, nextCursor: null },
			items: [{ entityId: { kind: "text", value: "library-1" } }],
		},
	},
} satisfies RyotQLResponse;

describe("user library recipe", () => {
	it("builds a user library entity lookup", () => {
		const query = buildUserLibraryDocument().queries.library;

		expect(query.from).toEqual({ alias: "library", table: "entity" });
		expect(query.output.pagination).toEqual({ limit: 1 });
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
	});

	it("decodes the user library entity id", () => {
		expect(Result.getOrThrow(decodeUserLibraryResponse(userLibraryResponse))).toEqual({
			entityId: "library-1",
		});
	});

	it("rejects a missing user library", () => {
		const response = { data: { library: { ...userLibraryResponse.data.library, items: [] } } };

		expect(Result.isFailure(decodeUserLibraryResponse(response))).toBe(true);
	});
});
