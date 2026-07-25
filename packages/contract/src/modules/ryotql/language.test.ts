import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { RyotQLDocument } from "./language";

const document = {
	queries: {
		collections: {
			from: { table: "entity", alias: "collection" },
			output: {
				orderBy: [],
				type: "rows",
				pagination: { page: 1, limit: 20 },
				fields: [{ key: "id", expr: { type: "column", tableAlias: "collection", field: "id" } }],
			},
		},
	},
} as const;

describe("RyotQLDocument", () => {
	it("decodes a named rows document", () => {
		expect(Schema.decodeUnknownSync(RyotQLDocument)(document)).toEqual(document);
	});

	it("rejects unknown keys throughout the document", () => {
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)({
				...document,
				queries: { collections: { ...document.queries.collections, authority: "admin" } },
			}),
		).toThrow();
	});

	it("rejects invalid pagination", () => {
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)({
				queries: {
					collections: {
						...document.queries.collections,
						output: { ...document.queries.collections.output, pagination: { page: 0, limit: 20 } },
					},
				},
			}),
		).toThrow();
	});
});
