import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { assert, describe, expect, it } from "vitest";

import { reconstructGroupFieldValue, reconstructMeasureValue } from "./executor/field-values";
import {
	aggregateOrderBySql,
	groupFieldSql,
	measureAggregationSql,
	relationshipRootWherePushdown,
	rootAliasResolver,
	timeBucketSql,
	timeColumnSql,
	timeRangeConditionSql,
	wherePushdown,
} from "./executor/sql";
import type {
	AggregationSpec,
	Expr,
	FieldSelector,
	RelationshipSource,
	RootSource,
} from "./language";

const dialect = new PgDialect();
const render = (fragment: ReturnType<typeof sql>) => {
	const query = dialect.sqlToQuery(fragment);
	return { sql: query.sql.toLowerCase(), params: query.params };
};
const nonNull = <T>(value: T | null): T => {
	assert(value !== null, "expected a non-null result");
	return value;
};

const entitySource: RootSource = {
	where: null,
	alias: "lesson",
	type: "entities",
	schemas: ["lesson"],
};
const multiEntitySource: RootSource = {
	where: null,
	alias: "lesson",
	type: "entities",
	schemas: ["book", "movie"],
};
const eventSource: RootSource = {
	where: null,
	type: "events",
	alias: "review",
	schemas: ["review"],
	entity: { alias: "item", schemas: ["book"] },
};
const relationshipSource: RelationshipSource = {
	where: null,
	alias: "membership",
	type: "relationships",
	schemas: ["member-of"],
	sourceEntity: { alias: "member", schemas: ["book"] },
	targetEntity: { alias: "collection", schemas: ["collection"] },
};

const target = (source: RootSource, alias: string) => nonNull(rootAliasResolver(source)(alias));
const propertyField = (schema: string, ...path: [string, ...string[]]): FieldSelector => ({
	path,
	schema,
	type: "property",
});
const eq = (alias: string, field: FieldSelector, value: unknown): Expr => ({
	operator: "eq",
	type: "comparison",
	right: { type: "literal", value },
	left: { type: "ref", sourceAlias: alias, field },
});

describe("groupFieldSql", () => {
	it("normalizes a single-schema property (nullif, no CASE)", () => {
		const result = render(
			nonNull(groupFieldSql(propertyField("lesson", "difficulty"), target(entitySource, "lesson"))),
		);
		expect(result.sql).toContain("nullif(jsonb_extract_path(e.properties");
		expect(result.sql).toContain("'null'::jsonb");
		expect(result.sql).not.toContain("case when");
		expect(result.params).toContain("difficulty");
	});

	it("guards a multi-schema property with a slug CASE", () => {
		const result = render(
			nonNull(groupFieldSql(propertyField("book", "title"), target(multiEntitySource, "lesson"))),
		);
		expect(result.sql).toContain("case when es.slug =");
		expect(result.sql).toContain("nullif(");
		expect(result.params).toContain("book");
	});

	it("maps non-timestamp system fields to their columns", () => {
		expect(
			render(
				nonNull(groupFieldSql({ type: "system", name: "name" }, target(entitySource, "lesson"))),
			).sql,
		).toContain("e.name");
		expect(
			render(
				nonNull(
					groupFieldSql({ type: "system", name: "entitySchemaId" }, target(entitySource, "lesson")),
				),
			).sql,
		).toContain("e.entity_schema_id");
	});

	it("falls back (null) for grouping by the whole properties object", () => {
		expect(
			groupFieldSql({ type: "system", name: "properties" }, target(entitySource, "lesson")),
		).toBeNull();
	});

	it("falls back (null) for grouping by a system timestamp field (µs vs ms precision)", () => {
		expect(
			groupFieldSql({ type: "system", name: "createdAt" }, target(entitySource, "lesson")),
		).toBeNull();
		expect(
			groupFieldSql({ type: "system", name: "occurredAt" }, target(eventSource, "review")),
		).toBeNull();
		expect(
			groupFieldSql(
				{ type: "system", name: "createdAt" },
				target(relationshipSource, "membership"),
			),
		).toBeNull();
	});

	it("maps schema metadata fields", () => {
		expect(
			render(
				nonNull(groupFieldSql({ type: "schema", name: "slug" }, target(entitySource, "lesson"))),
			).sql,
		).toContain("es.slug");
		expect(
			render(
				nonNull(
					groupFieldSql({ type: "schema", name: "isBuiltin" }, target(entitySource, "lesson")),
				),
			).sql,
		).toContain("es.is_builtin");
	});

	it("uses the event/endpoint alias for non-entity roots", () => {
		expect(
			render(
				nonNull(groupFieldSql({ type: "system", name: "entityId" }, target(eventSource, "review"))),
			).sql,
		).toContain("ev.entity_id");
		expect(
			render(
				nonNull(
					groupFieldSql(propertyField("book", "author"), target(relationshipSource, "member")),
				),
			).sql,
		).toContain("jsonb_extract_path(se.properties");
	});
});

describe("measureAggregationSql", () => {
	const resolve = rootAliasResolver(entitySource);
	const numericAggOf = (
		fn: "sum" | "average" | "minimum" | "maximum",
		schema: string,
		path: string,
	): AggregationSpec => ({
		function: fn,
		expr: { type: "ref", sourceAlias: "lesson", field: propertyField(schema, path) },
	});

	it("compiles count to COUNT(*)", () => {
		expect(render(nonNull(measureAggregationSql({ function: "count" }, resolve))).sql).toBe(
			"count(*)",
		);
	});

	it("does not push count-distinct", () => {
		expect(
			measureAggregationSql(
				{
					function: "count",
					distinctBy: { type: "ref", sourceAlias: "lesson", field: propertyField("lesson", "d") },
				},
				resolve,
			),
		).toBeNull();
	});

	it("compiles numeric sum/avg/min/max with a jsonb_typeof number guard and double precision cast", () => {
		const sum = render(
			nonNull(measureAggregationSql(numericAggOf("sum", "lesson", "dur"), resolve)),
		);
		expect(sum.sql).toContain("sum(");
		expect(sum.sql).toContain("jsonb_typeof(jsonb_extract_path(e.properties");
		expect(sum.sql).toContain("= 'number'");
		expect(sum.sql).toContain("::double precision");
		expect(
			render(nonNull(measureAggregationSql(numericAggOf("average", "lesson", "dur"), resolve))).sql,
		).toContain("avg(");
		expect(
			render(nonNull(measureAggregationSql(numericAggOf("minimum", "lesson", "dur"), resolve))).sql,
		).toContain("min(");
		expect(
			render(nonNull(measureAggregationSql(numericAggOf("maximum", "lesson", "dur"), resolve))).sql,
		).toContain("max(");
	});

	it("does not push a non-property operand", () => {
		expect(
			measureAggregationSql(
				{
					function: "sum",
					expr: { type: "ref", sourceAlias: "lesson", field: { type: "system", name: "name" } },
				},
				resolve,
			),
		).toBeNull();
	});
});

describe("aggregateOrderBySql", () => {
	const keys = new Map([
		["count", 0],
		["total", 1],
	]);
	it("orders by measure aliases", () => {
		const result = render(
			nonNull(
				aggregateOrderBySql(
					[
						{ order: "desc", expr: { type: "measureRef", key: "count" } },
						{ order: "asc", expr: { type: "measureRef", key: "total" } },
					],
					keys,
				),
			),
		);
		expect(result.sql).toContain('"m0" desc');
		expect(result.sql).toContain('"m1" asc');
	});

	it("returns null for an unknown measure key", () => {
		expect(
			aggregateOrderBySql([{ order: "asc", expr: { type: "measureRef", key: "missing" } }], keys),
		).toBeNull();
	});
});

describe("time-series SQL fragments", () => {
	it("truncates on UTC boundaries and returns a timestamptz", () => {
		const result = render(timeBucketSql("week", sql`ev.occurred_at`));
		expect(result.sql).toContain("date_trunc(");
		expect(result.sql).toContain("at time zone 'utc'");
		expect(result.params).toContain("week");
	});

	it("resolves a system date column as the time column, else null", () => {
		expect(
			render(
				nonNull(
					timeColumnSql({ type: "system", name: "occurredAt" }, target(eventSource, "review")),
				),
			).sql,
		).toBe("ev.occurred_at");
		expect(timeColumnSql({ type: "system", name: "id" }, target(eventSource, "review"))).toBeNull();
		expect(
			timeColumnSql(propertyField("lesson", "publishedAt"), target(entitySource, "lesson")),
		).toBeNull();
	});

	it("builds a half-open range predicate", () => {
		const result = render(
			timeRangeConditionSql(
				sql`ev.occurred_at`,
				"2026-01-01T00:00:00.000Z",
				"2026-02-01T00:00:00.000Z",
			),
		);
		expect(result.sql).toContain(">= $");
		expect(result.sql).toContain("< $");
		expect(result.sql).toContain("::timestamptz");
		expect(result.params).toEqual(["2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"]);
	});
});

describe("relationshipRootWherePushdown", () => {
	it("pushes filters on the relationship and both endpoint entities", () => {
		const where: Expr = {
			type: "and",
			values: [
				eq("membership", { type: "system", name: "sourceEntityId" }, "ent-1"),
				eq("member", propertyField("book", "author"), "Herbert"),
				eq("collection", { type: "system", name: "name" }, "Faves"),
			],
		};
		const result = relationshipRootWherePushdown({ ...relationshipSource, where }, "user-1");
		expect(result.residual).toBeNull();
		const rendered = result.conditions
			.map((condition) => dialect.sqlToQuery(condition).sql.toLowerCase())
			.join(" ");
		expect(rendered).toContain("r.source_entity_id =");
		expect(rendered).toContain("jsonb_extract_path_text(se.properties");
		expect(rendered).toContain("te.name =");
	});
});

const courseResolve = (ref: Extract<Expr, { type: "ref" }>) =>
	ref.sourceAlias === "course" ? { alias: "e", schemas: ["course"] } : null;
const moduleExists = (childWhere: Expr | null): Expr => ({
	type: "exists",
	source: {
		alias: "module",
		type: "entities",
		where: childWhere,
		schemas: ["module"],
		via: { entityRef: "course", alias: "cm", direction: "outgoing", schema: "course-module" },
	},
});
const completionExists: Expr = {
	type: "exists",
	source: {
		where: null,
		alias: "done",
		type: "events",
		entityRef: "module",
		schemas: ["complete"],
	},
};

describe("correlated exists / aggregate pushdown", () => {
	const push = (where: Expr) => {
		const result = wherePushdown(where, courseResolve, { userId: "user-1" });
		return {
			residual: result.residual,
			sql: result.conditions
				.map((condition) => dialect.sqlToQuery(condition).sql.toLowerCase())
				.join(" and "),
			params: result.conditions.flatMap((condition) => dialect.sqlToQuery(condition).params),
		};
	};

	it("compiles a correlated entity exists to EXISTS with slug-join visibility and correlation", () => {
		const result = push(moduleExists(null));
		expect(result.residual).toBeNull();
		expect(result.sql).toContain("exists (select 1");
		expect(result.sql).toContain("from relationship r1");
		expect(result.sql).toContain("r1.source_entity_id = e.id");
		expect(result.sql).toContain("e1s.slug in");
		expect(result.params).toContain("course-module");
		expect(result.params).toContain("module");
	});

	it("compiles a nested event exists correlated to the parent entity schema", () => {
		const result = push(moduleExists(completionExists));
		expect(result.residual).toBeNull();
		expect(result.sql).toContain("from event ev2");
		expect(result.sql).toContain("ev2.entity_id = e1.id");
		expect(result.sql).toContain("ev2s.entity_schema_id = e1.entity_schema_id");
	});

	it("compiles an aggregate count comparison to a scalar subquery", () => {
		const where: Expr = {
			operator: "gte",
			type: "comparison",
			right: { type: "literal", value: 2 },
			left: {
				type: "aggregate",
				aggregation: { function: "count" },
				source: {
					where: null,
					alias: "module",
					type: "entities",
					schemas: ["module"],
					via: { entityRef: "course", alias: "cm", direction: "outgoing", schema: "course-module" },
				},
			},
		};
		const result = push(where);
		expect(result.residual).toBeNull();
		expect(result.sql).toContain("(select count(*)");
		expect(result.sql).toContain(">= $");
		expect(result.params).toContain(2);
	});

	it("keeps exists app-side when the sub-where is not fully pushable", () => {
		const neqChild: Expr = {
			operator: "neq",
			type: "comparison",
			right: { type: "literal", value: "x" },
			left: { type: "ref", sourceAlias: "module", field: propertyField("module", "title") },
		};
		const where = moduleExists(neqChild);
		const result = push(where);
		expect(result.residual).toEqual(where);
		expect(result.sql).toBe("");
	});

	it("does not push exists/aggregate without the subquery capability", () => {
		const result = wherePushdown(moduleExists(null), courseResolve);
		expect(result.conditions).toHaveLength(0);
		expect(result.residual).toEqual(moduleExists(null));
	});
});

describe("reconstructGroupFieldValue", () => {
	const property = propertyField("lesson", "d");
	it("reconstructs property values by their JSON runtime type", () => {
		expect(reconstructGroupFieldValue(property, "entity", "advanced")).toEqual({
			kind: "text",
			value: "advanced",
		});
		expect(reconstructGroupFieldValue(property, "entity", 5)).toEqual({ kind: "number", value: 5 });
		expect(reconstructGroupFieldValue(property, "entity", true)).toEqual({
			value: true,
			kind: "boolean",
		});
		expect(reconstructGroupFieldValue(property, "entity", null)).toEqual({
			value: null,
			kind: "null",
		});
		expect(reconstructGroupFieldValue(property, "entity", { a: 1 })).toEqual({
			kind: "json",
			value: { a: 1 },
		});
	});

	it("reconstructs schema metadata", () => {
		expect(reconstructGroupFieldValue({ type: "schema", name: "slug" }, "entity", "books")).toEqual(
			{
				kind: "text",
				value: "books",
			},
		);
		expect(
			reconstructGroupFieldValue({ type: "schema", name: "isBuiltin" }, "entity", true),
		).toEqual({
			value: true,
			kind: "boolean",
		});
	});

	it("reconstructs system fields as date/text with null handling", () => {
		const date = new Date("2026-01-01T00:00:00.000Z");
		expect(
			reconstructGroupFieldValue({ type: "system", name: "createdAt" }, "entity", date),
		).toEqual({
			value: date,
			kind: "date",
		});
		expect(
			reconstructGroupFieldValue({ type: "system", name: "occurredAt" }, "event", date),
		).toEqual({
			value: date,
			kind: "date",
		});
		expect(reconstructGroupFieldValue({ type: "system", name: "name" }, "entity", "Dune")).toEqual({
			kind: "text",
			value: "Dune",
		});
		expect(reconstructGroupFieldValue({ type: "system", name: "userId" }, "entity", null)).toEqual({
			value: null,
			kind: "null",
		});
	});
});

describe("reconstructMeasureValue", () => {
	it("maps a numeric string/number to number and null to null", () => {
		expect(reconstructMeasureValue("3")).toEqual({ kind: "number", value: 3 });
		expect(reconstructMeasureValue(0)).toEqual({ kind: "number", value: 0 });
		expect(reconstructMeasureValue(60.5)).toEqual({ kind: "number", value: 60.5 });
		expect(reconstructMeasureValue(null)).toEqual({ kind: "null", value: null });
	});
});
