import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { Expr } from "../../language";
import { reconstructMeasureValue, reconstructOutputValue } from "../reconstruct";
import { compileBool, compileValue } from "./expr";
import { rootScope } from "./scope";

type ComparisonOp = Extract<Expr, { type: "comparison" }>["operator"];

const dialect = new PgDialect();
const render = (fragment: Parameters<typeof dialect.sqlToQuery>[0]) => dialect.sqlToQuery(fragment);

const scope = () =>
	rootScope({ type: "entities", alias: "course", schemas: ["course"], where: null }, "user-1");

const ref = (name: string): Expr => ({
	type: "ref",
	sourceAlias: "course",
	field: { type: "system", name },
});
const prop = (path: string): Expr => ({
	type: "ref",
	sourceAlias: "course",
	field: { type: "property", schema: "course", path: [path] },
});
const lit = (value: unknown, valueType?: "date"): Expr => ({ type: "literal", value, valueType });
const cmp = (operator: ComparisonOp, left: Expr, right: Expr): Expr => ({
	type: "comparison",
	operator,
	left,
	right,
});

describe("compileBool", () => {
	it("wraps comparisons in COALESCE(..., false) to preserve null-as-false", () => {
		const { sql } = render(compileBool(cmp("eq", prop("difficulty"), lit("hard")), scope()));
		expect(sql).toContain("COALESCE(");
		expect(sql).toContain(", false)");
	});

	it("compiles neq to a guarded <>", () => {
		const { sql } = render(compileBool(cmp("neq", prop("difficulty"), lit("hard")), scope()));
		expect(sql).toContain("<>");
		expect(sql).toContain("COALESCE(");
	});

	it("compiles not by negating the null-collapsed child", () => {
		const inner = cmp("eq", prop("difficulty"), lit("hard"));
		const { sql } = render(compileBool({ type: "not", expr: inner }, scope()));
		expect(sql).toContain("NOT ");
	});

	it('orders and compares text under COLLATE "C"', () => {
		const { sql } = render(compileBool(cmp("gt", prop("title"), lit("m")), scope()));
		expect(sql).toContain('COLLATE "C"');
	});

	it("compiles a numeric property comparison with a jsonb_typeof guard", () => {
		const { sql } = render(compileBool(cmp("gte", prop("duration"), lit(10)), scope()));
		expect(sql).toContain("jsonb_typeof(");
		expect(sql).toContain("double precision");
	});

	it("compiles contains to an escaped ILIKE for a literal needle", () => {
		const { sql, params } = render(
			compileBool({ type: "contains", left: prop("title"), right: lit("du_ne") }, scope()),
		);
		expect(sql).toContain("ILIKE");
		expect(params).toContain("%du\\_ne%");
	});

	it("compiles exists to EXISTS (SELECT 1 ...) with visibility", () => {
		const existsExpr: Expr = {
			type: "exists",
			source: { type: "events", alias: "ev", entityRef: "course", schemas: ["watch"], where: null },
		};
		const { sql } = render(compileBool(existsExpr, scope()));
		expect(sql).toContain("EXISTS (SELECT 1");
		expect(sql).toContain("user_id");
	});

	it("compiles a correlated count aggregate comparison to a scalar subquery", () => {
		const aggExpr: Expr = {
			type: "comparison",
			operator: "gte",
			left: {
				type: "aggregate",
				aggregation: { function: "count" },
				source: {
					type: "entities",
					alias: "m",
					schemas: ["module"],
					where: null,
					via: { entityRef: "course", alias: "cm", direction: "outgoing", schema: "course-module" },
				},
			},
			right: lit(2),
		};
		const { sql } = render(compileBool(aggExpr, scope()));
		expect(sql).toContain("SELECT COUNT(*)");
	});
});

describe("compileValue", () => {
	it("tags a system date column with the date kind and null-guards it", () => {
		const { sql, params } = render(compileValue(ref("createdAt"), scope()).kind);
		expect(sql).toContain("IS NULL");
		expect(params).toContain("date");
	});

	it("derives a property's kind from jsonb_typeof at runtime", () => {
		const { sql } = render(compileValue(prop("difficulty"), scope()).kind);
		expect(sql).toContain("jsonb_typeof(");
	});

	it("casts a literal before to_jsonb so the parameter type is known", () => {
		const { sql } = render(compileValue(lit(5), scope()).value);
		expect(sql).toContain("to_jsonb(");
		expect(sql).toContain("double precision");
	});

	it("compiles count-distinct to COUNT(DISTINCT ...)", () => {
		const distinctAgg: Expr = {
			type: "aggregate",
			aggregation: { function: "count", distinctBy: prop("difficulty") },
			source: {
				type: "entities",
				alias: "m",
				schemas: ["module"],
				where: null,
				via: { entityRef: "course", alias: "cm", direction: "outgoing", schema: "course-module" },
			},
		};
		const { sql } = render(compileValue(distinctAgg, scope()).value);
		expect(sql).toContain("COUNT(DISTINCT");
	});

	it("compiles first to an ordered LIMIT 1 subquery", () => {
		const occurredAt: Expr = {
			type: "ref",
			sourceAlias: "ev",
			field: { type: "system", name: "occurredAt" },
		};
		const firstExpr: Expr = {
			type: "first",
			select: occurredAt,
			orderBy: [{ order: "desc", expr: occurredAt }],
			source: { type: "events", alias: "ev", entityRef: "course", schemas: ["watch"], where: null },
		};
		const { sql } = render(compileValue(firstExpr, scope()).value);
		expect(sql).toContain("ORDER BY");
		expect(sql).toContain("LIMIT 1");
	});
});

describe("reconstructOutputValue", () => {
	it("maps kind + value pairs to FieldValues", () => {
		expect(reconstructOutputValue("hi", "text")).toEqual({ kind: "text", value: "hi" });
		expect(reconstructOutputValue(3, "number")).toEqual({ kind: "number", value: 3 });
		expect(reconstructOutputValue(true, "boolean")).toEqual({ kind: "boolean", value: true });
	});

	it("treats a null value or 'null' kind as the null kind", () => {
		expect(reconstructOutputValue(null, "text")).toEqual({ kind: "null", value: null });
		expect(reconstructOutputValue("x", "null")).toEqual({ kind: "null", value: null });
	});
});

describe("reconstructMeasureValue", () => {
	it("maps a numeric aggregate and null-over-empty", () => {
		expect(reconstructMeasureValue("5")).toEqual({ kind: "number", value: 5 });
		expect(reconstructMeasureValue(null)).toEqual({ kind: "null", value: null });
	});
});
