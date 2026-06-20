import { Expr } from "@ryot/contract/modules/query-engine/language";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

const decodeSync = Schema.decodeUnknownSync;

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

	it("decodes an 'arithmetic' expression with nested operands", () => {
		const result = decodeSync(Expr)({
			type: "arithmetic",
			operator: "divide",
			right: { type: "literal", value: 10 },
			left: { type: "ref", sourceAlias: "e", field: { type: "system", name: "name" } },
		});
		expect(result.type).toBe("arithmetic");
	});

	it("throws for an unknown arithmetic operator", () => {
		expect(() =>
			decodeSync(Expr)({
				type: "arithmetic",
				operator: "modulo",
				left: { type: "literal", value: 1 },
				right: { type: "literal", value: 2 },
			}),
		).toThrow();
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

	it("decodes an 'exists' expression over an event source", () => {
		const result = decodeSync(Expr)({
			type: "exists",
			source: {
				where: null,
				type: "events",
				alias: "completion",
				entityRef: "lesson",
				schemas: ["complete"],
			},
		});
		expect(result.type).toBe("exists");
	});

	it("decodes an 'aggregate' expression with count distinctBy", () => {
		const result = decodeSync(Expr)({
			type: "aggregate",
			aggregation: {
				function: "count",
				distinctBy: { type: "ref", sourceAlias: "lesson", field: { type: "system", name: "id" } },
			},
			source: {
				where: null,
				alias: "lesson",
				type: "entities",
				schemas: ["lesson"],
				via: {
					entityRef: "module",
					alias: "moduleLesson",
					direction: "outgoing",
					schema: "module-lesson",
				},
			},
		});

		expect(result.type).toBe("aggregate");
	});

	it("decodes a 'first' expression over an ordered event source", () => {
		const result = decodeSync(Expr)({
			type: "first",
			select: {
				type: "ref",
				sourceAlias: "completion",
				field: { type: "system", name: "occurredAt" },
			},
			source: {
				where: null,
				type: "events",
				alias: "completion",
				entityRef: "lesson",
				schemas: ["complete"],
			},
			orderBy: [
				{
					order: "desc",
					expr: {
						type: "ref",
						sourceAlias: "completion",
						field: { type: "system", name: "occurredAt" },
					},
				},
			],
		});

		expect(result.type).toBe("first");
	});

	it("throws when a 'first' expression has empty orderBy", () => {
		expect(() =>
			decodeSync(Expr)({
				orderBy: [],
				type: "first",
				select: { type: "literal", value: null },
				source: {
					where: null,
					type: "events",
					alias: "completion",
					entityRef: "lesson",
					schemas: ["complete"],
				},
			}),
		).toThrow();
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

	it("throws when a boolean expression uses the old predicates key", () => {
		expect(() =>
			decodeSync(Expr)({ type: "and", predicates: [{ type: "literal", value: true }] }),
		).toThrow();
	});

	it("throws when a unary expression uses the old predicate key", () => {
		expect(() =>
			decodeSync(Expr)({ type: "not", predicate: { type: "literal", value: true } }),
		).toThrow();
	});

	it("throws when an expression has an excess property", () => {
		expect(() => decodeSync(Expr)({ type: "literal", value: 42, filter: true })).toThrow();
	});
});
