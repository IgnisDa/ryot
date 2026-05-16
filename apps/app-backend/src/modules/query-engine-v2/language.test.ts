import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { Expr, FieldSelector, QueryDocumentV2, RowsReturnV2 } from "./language";

const decodeSync = Schema.decodeUnknownSync;

describe("FieldSelector", () => {
	it("decodes a system field selector", () => {
		const result = decodeSync(FieldSelector)({ type: "system", name: "id" });
		expect(result).toEqual({ type: "system", name: "id" });
	});

	it("decodes a property field selector", () => {
		const result = decodeSync(FieldSelector)({
			path: ["title"],
			schema: "books",
			type: "property",
		});
		expect(result).toEqual({ type: "property", schema: "books", path: ["title"] });
	});

	it("decodes a property field selector with a nested path", () => {
		const result = decodeSync(FieldSelector)({
			schema: "books",
			type: "property",
			path: ["meta", "publisher"],
		});
		expect(result).toEqual({ type: "property", schema: "books", path: ["meta", "publisher"] });
	});

	it("decodes a schema metadata selector for 'slug'", () => {
		const result = decodeSync(FieldSelector)({ type: "schema", name: "slug" });
		expect(result).toEqual({ type: "schema", name: "slug" });
	});

	it("decodes a schema metadata selector for 'name'", () => {
		const result = decodeSync(FieldSelector)({ type: "schema", name: "name" });
		expect(result).toEqual({ type: "schema", name: "name" });
	});

	it("throws for an unknown selector type", () => {
		expect(() => decodeSync(FieldSelector)({ type: "unknown" })).toThrow();
	});

	it("throws for a schema metadata selector with an invalid name", () => {
		expect(() => decodeSync(FieldSelector)({ type: "schema", name: "id" })).toThrow();
	});
});

describe("Expr", () => {
	it("decodes a literal expression", () => {
		expect(decodeSync(Expr)({ type: "literal", value: 42 })).toEqual({
			value: 42,
			type: "literal",
		});
	});

	it("decodes a literal expression with valueType 'date'", () => {
		const result = decodeSync(Expr)({ type: "literal", value: "2024-01-01", valueType: "date" });
		expect(result).toEqual({ type: "literal", value: "2024-01-01", valueType: "date" });
	});

	it("decodes a ref expression", () => {
		const result = decodeSync(Expr)({
			type: "ref",
			sourceAlias: "e",
			field: { type: "system", name: "name" },
		});
		expect(result).toEqual({
			type: "ref",
			sourceAlias: "e",
			field: { type: "system", name: "name" },
		});
	});

	it("decodes a comparison expression with nested refs", () => {
		const result = decodeSync(Expr)({
			operator: "eq",
			type: "comparison",
			right: { type: "literal", value: "Dune" },
			left: { type: "ref", sourceAlias: "e", field: { type: "system", name: "name" } },
		});
		expect(result.type).toBe("comparison");
	});

	it("decodes an 'and' expression with multiple values", () => {
		const result = decodeSync(Expr)({
			type: "and",
			values: [
				{ type: "literal", value: true },
				{ type: "literal", value: false },
			],
		});
		expect(result.type).toBe("and");
	});

	it("decodes an 'or' expression", () => {
		const result = decodeSync(Expr)({
			type: "or",
			values: [
				{ type: "literal", value: 1 },
				{ type: "literal", value: 2 },
			],
		});
		expect(result.type).toBe("or");
	});

	it("decodes a 'not' expression", () => {
		const result = decodeSync(Expr)({ type: "not", expr: { type: "literal", value: false } });
		expect(result.type).toBe("not");
	});

	it("decodes an 'isNull' expression", () => {
		const result = decodeSync(Expr)({
			type: "isNull",
			expr: { type: "ref", sourceAlias: "e", field: { type: "system", name: "image" } },
		});
		expect(result.type).toBe("isNull");
	});

	it("decodes an 'isNotNull' expression", () => {
		const result = decodeSync(Expr)({
			type: "isNotNull",
			expr: { type: "ref", sourceAlias: "e", field: { type: "system", name: "image" } },
		});
		expect(result.type).toBe("isNotNull");
	});

	it("decodes a 'contains' expression", () => {
		const result = decodeSync(Expr)({
			type: "contains",
			left: { type: "ref", sourceAlias: "e", field: { type: "system", name: "name" } },
			right: { type: "literal", value: "Dune" },
		});
		expect(result.type).toBe("contains");
	});

	it("decodes a 'coalesce' expression", () => {
		const result = decodeSync(Expr)({
			type: "coalesce",
			values: [
				{ type: "literal", value: null },
				{ type: "literal", value: "fallback" },
			],
		});
		expect(result.type).toBe("coalesce");
	});

	it("decodes deeply nested recursive expressions", () => {
		const result = decodeSync(Expr)({
			type: "and",
			values: [
				{
					type: "or",
					values: [
						{ type: "not", expr: { type: "literal", value: false } },
						{
							type: "isNull",
							expr: { type: "ref", sourceAlias: "e", field: { type: "system", name: "image" } },
						},
					],
				},
				{ type: "literal", value: true },
			],
		});
		expect(result.type).toBe("and");
	});

	it("throws for an unknown expression type", () => {
		expect(() => decodeSync(Expr)({ type: "between", value: 5 })).toThrow();
	});
});

describe("RowsReturnV2", () => {
	it("decodes a minimal rows return with no fields", () => {
		const result = decodeSync(RowsReturnV2)({
			fields: [],
			type: "rows",
			pagination: { page: 1, limit: 10 },
			orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
		});
		expect(result.type).toBe("rows");
		expect(result.fields).toHaveLength(0);
	});

	it("decodes fields array with multiple entries", () => {
		const result = decodeSync(RowsReturnV2)({
			type: "rows",
			pagination: { page: 2, limit: 50 },
			orderBy: [{ order: "desc", expr: { type: "literal", value: 1 } }],
			fields: [
				{ key: "title", expr: { type: "literal", value: "x" } },
				{ key: "year", expr: { type: "literal", value: 2024 } },
			],
		});
		expect(result.fields).toHaveLength(2);
		expect(result.pagination.page).toBe(2);
		expect(result.pagination.limit).toBe(50);
	});

	it("throws when orderBy is empty", () => {
		expect(() =>
			decodeSync(RowsReturnV2)({
				fields: [],
				orderBy: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
			}),
		).toThrow();
	});

	it("throws when pagination page is zero", () => {
		expect(() =>
			decodeSync(RowsReturnV2)({
				fields: [],
				type: "rows",
				pagination: { page: 0, limit: 10 },
				orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
			}),
		).toThrow();
	});

	it("throws when pagination limit is zero", () => {
		expect(() =>
			decodeSync(RowsReturnV2)({
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 0 },
				orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
			}),
		).toThrow();
	});
});

describe("QueryDocumentV2", () => {
	const minimal = {
		version: 2,
		source: { type: "entities", alias: "e", schemas: ["books"], where: null },
		return: {
			fields: [],
			type: "rows",
			pagination: { page: 1, limit: 10 },
			orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
		},
	};

	it("decodes a minimal valid document", () => {
		const result = decodeSync(QueryDocumentV2)(minimal);
		expect(result.version).toBe(2);
		expect(result.source.alias).toBe("e");
	});

	it("decodes a document with a non-null where clause", () => {
		const result = decodeSync(QueryDocumentV2)({
			...minimal,
			source: {
				...minimal.source,
				where: {
					type: "isNull",
					expr: { type: "ref", sourceAlias: "e", field: { type: "system", name: "image" } },
				},
			},
		});
		expect(result.source.where).not.toBeNull();
	});

	it("throws when version is not 2", () => {
		expect(() => decodeSync(QueryDocumentV2)({ ...minimal, version: 1 })).toThrow();
	});

	it("throws when source schemas list is empty", () => {
		expect(() =>
			decodeSync(QueryDocumentV2)({
				...minimal,
				source: { ...minimal.source, schemas: [] },
			}),
		).toThrow();
	});
});
