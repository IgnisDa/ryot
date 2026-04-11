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

const makeDocument = (expr: unknown) => ({
	queries: {
		entities: {
			from: { table: "entity", alias: "entity" },
			output: {
				orderBy: [],
				type: "rows",
				fields: [{ key: "value", expr }],
				pagination: { page: 1, limit: 20 },
			},
		},
	},
});

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

	it("decodes recursive JSON and predicate expressions", () => {
		const properties = { type: "column", tableAlias: "entity", field: "properties" } as const;
		const score = {
			type: "cast",
			target: "number",
			expr: { type: "jsonPath", expr: properties, path: ["details", 0, "score"] },
		} as const;
		const complex = {
			queries: {
				entities: {
					from: { table: "entity", alias: "entity" },
					where: {
						type: "and",
						predicates: [
							{
								left: score,
								operator: "gte",
								type: "comparison",
								right: { type: "literal", value: 4 },
							},
							{ type: "isNotNull", expr: score },
						],
					},
					output: {
						type: "rows",
						pagination: { page: 1, limit: 20 },
						orderBy: [{ direction: "desc", expr: score }],
						fields: [
							{
								key: "score",
								expr: { type: "coalesce", values: [score, { type: "literal", value: 0 }] },
							},
						],
					},
				},
			},
		} as const;

		expect(Schema.decodeUnknownSync(RyotQLDocument)(complex)).toEqual(complex);
	});

	it("rejects malformed JSON paths, cast targets, and nested unknown keys", () => {
		const expression = { type: "column", tableAlias: "entity", field: "properties" };

		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(
				makeDocument({ type: "jsonPath", path: [], expr: expression }),
			),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(
				makeDocument({ type: "cast", target: "integer", expr: expression }),
			),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(
				makeDocument({ type: "cast", target: "json", expr: expression, unsafe: true }),
			),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(
				makeDocument({ type: "literal", value: Number.POSITIVE_INFINITY }),
			),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(makeDocument({ type: "literal", value: 1n })),
		).toThrow();
	});
});
