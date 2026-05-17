import { PgDialect } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { assert, describe, expect, it } from "vitest";

import { CurrentDb } from "#lib/db";

import { makeEmptyContext } from "./executor/context";
import { evalExprValue } from "./executor/expr";
import {
	evalFieldSelector,
	evalSystemRef,
	getNestedValue,
	valueToFieldValue,
} from "./executor/field-values";
import { entityFirstOrderSql, eventFirstOrderSql } from "./executor/first";
import {
	entityJsonbObjectSql,
	eventIncludeOrderSql,
	fieldSelectorToOrderSql,
	includeOrderSql,
	relationshipRootOrderSql,
} from "./executor/sql";
import type { EntityQueryRow } from "./executor/types";
import type {
	EntitySource,
	Expr,
	FieldSelector,
	IncludeEntry,
	NestedEventSource,
	RelationshipSource,
	RowsOutput,
} from "./language";

const dialect = new PgDialect();

const evalExpr = (expr: Expr) =>
	Effect.runSync(
		evalExprValue("user-1", expr, makeEmptyContext()).pipe(
			Effect.provideService(CurrentDb, Object.create(null)),
		),
	);

const arithmeticExpr = (
	operator: "add" | "subtract" | "multiply" | "divide",
	left: number,
	right: number,
): Expr => ({
	operator,
	type: "arithmetic",
	left: { type: "literal", value: left },
	right: { type: "literal", value: right },
});

const baseRow: EntityQueryRow = {
	id: "row-1",
	image: null,
	name: "Dune",
	externalId: null,
	totalCount: "42",
	schemaSlug: "books",
	schemaName: "Books",
	schemaIsBuiltin: false,
	sandboxScriptId: null,
	schemaId: "schema-books",
	createdAt: new Date("2024-01-01"),
	updatedAt: new Date("2024-06-01"),
	properties: { title: "Dune", year: 1965, nested: { publisher: "Chilton" } },
};

describe("valueToFieldValue", () => {
	it("maps null to {kind: 'null'}", () => {
		expect(valueToFieldValue(null)).toEqual({ kind: "null", value: null });
	});

	it("maps undefined to {kind: 'null'}", () => {
		expect(valueToFieldValue(undefined)).toEqual({ kind: "null", value: null });
	});

	it("maps a string to {kind: 'text'}", () => {
		expect(valueToFieldValue("hello")).toEqual({ kind: "text", value: "hello" });
	});

	it("maps a number to {kind: 'number'}", () => {
		expect(valueToFieldValue(42)).toEqual({ kind: "number", value: 42 });
	});

	it("maps a boolean to {kind: 'boolean'}", () => {
		expect(valueToFieldValue(true)).toEqual({ kind: "boolean", value: true });
		expect(valueToFieldValue(false)).toEqual({ kind: "boolean", value: false });
	});

	it("maps an object to {kind: 'json'}", () => {
		const obj = { a: 1 };
		expect(valueToFieldValue(obj)).toEqual({ kind: "json", value: obj });
	});

	it("maps an array to {kind: 'json'}", () => {
		expect(valueToFieldValue([1, 2])).toEqual({ kind: "json", value: [1, 2] });
	});
});

describe("evalSystemRef", () => {
	it("resolves 'id' to text", () => {
		expect(evalSystemRef("id", baseRow)).toEqual({ kind: "text", value: "row-1" });
	});

	it("resolves 'name' to text", () => {
		expect(evalSystemRef("name", baseRow)).toEqual({ kind: "text", value: "Dune" });
	});

	it("resolves 'image' to null when image is null", () => {
		expect(evalSystemRef("image", baseRow)).toEqual({ kind: "null", value: null });
	});

	it("resolves 'image' to {kind: 'image'} when image is present", () => {
		const row = { ...baseRow, image: "https://example.com/cover.jpg" };
		expect(evalSystemRef("image", row)).toEqual({
			kind: "image",
			value: "https://example.com/cover.jpg",
		});
	});

	it("resolves 'createdAt' to date", () => {
		const result = evalSystemRef("createdAt", baseRow);
		expect(result.kind).toBe("date");
		expect(result.value).toEqual(new Date("2024-01-01"));
	});

	it("resolves 'updatedAt' to date", () => {
		const result = evalSystemRef("updatedAt", baseRow);
		expect(result.kind).toBe("date");
	});

	it("resolves 'externalId' to null when null", () => {
		expect(evalSystemRef("externalId", baseRow)).toEqual({ kind: "null", value: null });
	});

	it("resolves 'externalId' to text when present", () => {
		const row = { ...baseRow, externalId: "ext-42" };
		expect(evalSystemRef("externalId", row)).toEqual({ kind: "text", value: "ext-42" });
	});

	it("resolves 'sandboxScriptId' to null when null", () => {
		expect(evalSystemRef("sandboxScriptId", baseRow)).toEqual({ kind: "null", value: null });
	});

	it("resolves 'sandboxScriptId' to text when present", () => {
		const row = { ...baseRow, sandboxScriptId: "script-7" };
		expect(evalSystemRef("sandboxScriptId", row)).toEqual({ kind: "text", value: "script-7" });
	});

	it("returns null for an unrecognized field name", () => {
		expect(evalSystemRef("bogus", baseRow)).toEqual({ kind: "null", value: null });
	});
});

describe("getNestedValue", () => {
	const obj = { a: { b: { c: "deep" } }, x: 0 };

	it("retrieves a top-level value", () => {
		expect(getNestedValue(obj, ["x"])).toBe(0);
	});

	it("retrieves a deeply nested value", () => {
		expect(getNestedValue(obj, ["a", "b", "c"])).toBe("deep");
	});

	it("returns null for a missing key", () => {
		expect(getNestedValue(obj, ["missing"])).toBeNull();
	});

	it("returns null when the path traverses through a non-object", () => {
		expect(getNestedValue(obj, ["x", "deeper"])).toBeNull();
	});

	it("returns null when an intermediate key is null", () => {
		expect(getNestedValue({ a: null } as Record<string, unknown>, ["a", "b"])).toBeNull();
	});
});

describe("evalFieldSelector", () => {
	it("delegates system fields to evalSystemRef", () => {
		const field: FieldSelector = { type: "system", name: "id" };
		expect(evalFieldSelector(field, baseRow)).toEqual({ kind: "text", value: "row-1" });
	});

	it("returns null for a property field whose schema does not match the row", () => {
		const field: FieldSelector = { type: "property", schema: "movies", path: ["title"] };
		expect(evalFieldSelector(field, baseRow)).toEqual({ kind: "null", value: null });
	});

	it("returns the property value when the schema matches", () => {
		const field: FieldSelector = { type: "property", schema: "books", path: ["title"] };
		expect(evalFieldSelector(field, baseRow)).toEqual({ kind: "text", value: "Dune" });
	});

	it("returns a nested property value", () => {
		const field: FieldSelector = {
			schema: "books",
			type: "property",
			path: ["nested", "publisher"],
		};
		expect(evalFieldSelector(field, baseRow)).toEqual({ kind: "text", value: "Chilton" });
	});

	it("returns null for a missing property path", () => {
		const field: FieldSelector = { type: "property", schema: "books", path: ["nonexistent"] };
		expect(evalFieldSelector(field, baseRow)).toEqual({ kind: "null", value: null });
	});

	it("returns schemaSlug for schema 'slug' field", () => {
		const field: FieldSelector = { type: "schema", name: "slug" };
		expect(evalFieldSelector(field, baseRow)).toEqual({ kind: "text", value: "books" });
	});

	it("returns schemaName for schema 'name' field", () => {
		const field: FieldSelector = { type: "schema", name: "name" };
		expect(evalFieldSelector(field, baseRow)).toEqual({ kind: "text", value: "Books" });
	});

	it("returns schemaIsBuiltin for schema 'isBuiltin' field", () => {
		const field: FieldSelector = { type: "schema", name: "isBuiltin" };
		expect(evalFieldSelector(field, { ...baseRow, schemaIsBuiltin: true })).toEqual({
			kind: "boolean",
			value: true,
		});
	});
});

describe("evalExprValue date literal", () => {
	it("resolves a date literal to {kind: 'date'} keeping the string value", () => {
		expect(
			evalExpr({ type: "literal", value: "2026-01-01T00:00:00.000Z", valueType: "date" }),
		).toEqual({ kind: "date", value: "2026-01-01T00:00:00.000Z" });
	});

	it("resolves a non-date string literal to {kind: 'text'}", () => {
		expect(evalExpr({ type: "literal", value: "2026-01-01T00:00:00.000Z" })).toEqual({
			kind: "text",
			value: "2026-01-01T00:00:00.000Z",
		});
	});

	it("resolves a null date literal to {kind: 'null'}", () => {
		expect(evalExpr({ type: "literal", value: null, valueType: "date" })).toEqual({
			kind: "null",
			value: null,
		});
	});
});

describe("evalExprValue arithmetic", () => {
	it("adds two numbers", () => {
		expect(evalExpr(arithmeticExpr("add", 3, 4))).toEqual({ kind: "number", value: 7 });
	});

	it("subtracts two numbers", () => {
		expect(evalExpr(arithmeticExpr("subtract", 10, 4))).toEqual({ kind: "number", value: 6 });
	});

	it("multiplies two numbers", () => {
		expect(evalExpr(arithmeticExpr("multiply", 6, 7))).toEqual({ kind: "number", value: 42 });
	});

	it("divides two numbers", () => {
		expect(evalExpr(arithmeticExpr("divide", 9, 3))).toEqual({ kind: "number", value: 3 });
	});

	it("returns null for division by zero", () => {
		expect(evalExpr(arithmeticExpr("divide", 9, 0))).toEqual({ kind: "null", value: null });
	});

	it("returns null when the left operand is not numeric", () => {
		expect(
			evalExpr({
				operator: "add",
				type: "arithmetic",
				left: { type: "literal", value: "ten" },
				right: { type: "literal", value: 5 },
			}),
		).toEqual({ kind: "null", value: null });
	});

	it("returns null when the right operand is null", () => {
		expect(
			evalExpr({
				operator: "multiply",
				type: "arithmetic",
				left: { type: "literal", value: 5 },
				right: { type: "literal", value: null },
			}),
		).toEqual({ kind: "null", value: null });
	});
});

describe("fieldSelectorToOrderSql", () => {
	const toSql = (field: FieldSelector, schemas: [string, ...string[]] = ["books"]) => {
		const result = fieldSelectorToOrderSql(field, schemas);
		assert(result !== null, "expected non-null SQL result");
		return dialect.sqlToQuery(result);
	};

	it("returns SQL referencing the entity name column for system 'name'", () => {
		const query = toSql({ type: "system", name: "name" });
		expect(query.sql).toContain("e.name");
	});

	it("returns SQL referencing e.id for system 'id'", () => {
		const query = toSql({ type: "system", name: "id" });
		expect(query.sql).toContain("e.id");
	});

	it("returns SQL referencing e.created_at for system 'createdAt'", () => {
		const query = toSql({ type: "system", name: "createdAt" });
		expect(query.sql).toContain("e.created_at");
	});

	it("returns null for an unknown system field", () => {
		expect(fieldSelectorToOrderSql({ type: "system", name: "bogus" }, ["books"])).toBeNull();
	});

	it("uses numeric-safe jsonb_extract_path (not _text) for a single-schema property field", () => {
		const query = toSql({ type: "property", schema: "books", path: ["title"] }, ["books"]);
		expect(query.sql.toLowerCase()).toContain("jsonb_extract_path(");
		expect(query.sql.toLowerCase()).not.toContain("jsonb_extract_path_text");
		expect(query.sql.toLowerCase()).not.toContain("case when");
	});

	it("wraps property in CASE WHEN for multi-schema sources", () => {
		const query = toSql({ type: "property", schema: "books", path: ["title"] }, [
			"books",
			"movies",
		]);
		expect(query.sql.toLowerCase()).toContain("case when");
		expect(query.sql.toLowerCase()).toContain("jsonb_extract_path(");
		expect(query.sql.toLowerCase()).not.toContain("jsonb_extract_path_text");
	});

	it("returns es.slug for schema 'slug' metadata field", () => {
		const query = toSql({ type: "schema", name: "slug" });
		expect(query.sql).toContain("es.slug");
	});

	it("returns es.name for schema 'name' metadata field", () => {
		const query = toSql({ type: "schema", name: "name" });
		expect(query.sql).toContain("es.name");
	});

	it("returns es.is_builtin for schema 'isBuiltin' metadata field", () => {
		const query = toSql({ type: "schema", name: "isBuiltin" });
		expect(query.sql).toContain("es.is_builtin");
	});
});

describe("entityJsonbObjectSql", () => {
	const toSql = (entityAlias: string, schemaAlias: string) =>
		dialect.sqlToQuery(entityJsonbObjectSql(entityAlias, schemaAlias));

	it("builds a jsonb_build_object expression", () => {
		const query = toSql("se", "ses");
		expect(query.sql.toLowerCase()).toContain("jsonb_build_object");
	});

	it("qualifies entity columns with the given entity alias", () => {
		const query = toSql("se", "ses");
		expect(query.sql).toContain("se.id");
		expect(query.sql).toContain("se.name");
		expect(query.sql).toContain("se.image");
		expect(query.sql).toContain("se.created_at");
		expect(query.sql).toContain("se.updated_at");
		expect(query.sql).toContain("se.properties");
		expect(query.sql).toContain("se.external_id");
		expect(query.sql).toContain("se.sandbox_script_id");
	});

	it("qualifies schema columns with the given schema alias", () => {
		const query = toSql("se", "ses");
		expect(query.sql).toContain("ses.id");
		expect(query.sql).toContain("ses.slug");
		expect(query.sql).toContain("ses.name");
		expect(query.sql).toContain("ses.is_builtin");
	});

	it("uses distinct aliases for the source and target entity sides", () => {
		const sourceQuery = toSql("se", "ses");
		const targetQuery = toSql("te", "tes");
		expect(sourceQuery.sql).not.toBe(targetQuery.sql);
		expect(targetQuery.sql).toContain("te.id");
		expect(targetQuery.sql).toContain("tes.slug");
		expect(targetQuery.sql).not.toContain("se.id");
	});
});

const makeRelationshipRootOrderOutput = (orderBy: RowsOutput["orderBy"]): RowsOutput => ({
	orderBy,
	fields: [],
	type: "rows",
	pagination: { page: 1, limit: 10 },
});

describe("relationshipRootOrderSql", () => {
	const source: RelationshipSource = {
		where: null,
		alias: "membership",
		type: "relationships",
		schemas: ["member-of"],
		sourceEntity: { alias: "memberEntity", schemas: ["books"] },
		targetEntity: { alias: "collectionEntity", schemas: ["collections"] },
	};

	it("orders by the relationship's own system field", () => {
		const output = makeRelationshipRootOrderOutput([
			{
				order: "desc",
				expr: {
					type: "ref",
					sourceAlias: "membership",
					field: { type: "system", name: "createdAt" },
				},
			},
		]);
		const query = dialect.sqlToQuery(relationshipRootOrderSql(source, output));
		expect(query.sql).toContain("r.created_at");
		expect(query.sql.toUpperCase()).toContain("DESC");
	});

	it("orders ascending when requested", () => {
		const output = makeRelationshipRootOrderOutput([
			{
				order: "asc",
				expr: {
					type: "ref",
					sourceAlias: "membership",
					field: { type: "system", name: "createdAt" },
				},
			},
		]);
		const query = dialect.sqlToQuery(relationshipRootOrderSql(source, output));
		expect(query.sql.toUpperCase()).toContain("ASC");
	});

	it("orders by the source entity alias system field via se", () => {
		const output = makeRelationshipRootOrderOutput([
			{
				order: "asc",
				expr: { type: "ref", sourceAlias: "memberEntity", field: { type: "system", name: "name" } },
			},
		]);
		const query = dialect.sqlToQuery(relationshipRootOrderSql(source, output));
		expect(query.sql).toContain("se.name");
		expect(query.sql.toUpperCase()).toContain("ASC");
	});

	it("orders by the target entity alias system field via te", () => {
		const output = makeRelationshipRootOrderOutput([
			{
				order: "desc",
				expr: {
					type: "ref",
					sourceAlias: "collectionEntity",
					field: { type: "system", name: "name" },
				},
			},
		]);
		const query = dialect.sqlToQuery(relationshipRootOrderSql(source, output));
		expect(query.sql).toContain("te.name");
		expect(query.sql.toUpperCase()).toContain("DESC");
	});

	it("orders by a source entity property via ses metadata for multi-schema endpoints", () => {
		const multiSchemaSource: RelationshipSource = {
			...source,
			sourceEntity: { alias: "memberEntity", schemas: ["books", "movies"] },
		};
		const output = makeRelationshipRootOrderOutput([
			{
				order: "asc",
				expr: {
					type: "ref",
					sourceAlias: "memberEntity",
					field: { type: "property", schema: "books", path: ["author"] },
				},
			},
		]);
		const query = dialect.sqlToQuery(relationshipRootOrderSql(multiSchemaSource, output));
		expect(query.sql.toLowerCase()).toContain("case when");
		expect(query.sql).toContain("ses.slug");
		expect(query.sql).toContain("se.properties");
	});

	it("orders by a target entity schema metadata field via tes", () => {
		const output = makeRelationshipRootOrderOutput([
			{
				order: "asc",
				expr: {
					type: "ref",
					sourceAlias: "collectionEntity",
					field: { type: "schema", name: "slug" },
				},
			},
		]);
		const query = dialect.sqlToQuery(relationshipRootOrderSql(source, output));
		expect(query.sql).toContain("tes.slug");
	});

	it("falls back to a constant for non-ref expressions", () => {
		const output = makeRelationshipRootOrderOutput([
			{ order: "asc", expr: { type: "literal", value: 1 } },
		]);
		const query = dialect.sqlToQuery(relationshipRootOrderSql(source, output));
		expect(query.sql.trim()).toBe("1");
	});
});

describe("includeOrderSql", () => {
	const entitySource: EntitySource = {
		where: null,
		alias: "module",
		type: "entities",
		schemas: ["modules"],
		via: {
			entityRef: "course",
			alias: "courseModule",
			direction: "outgoing",
			schema: "course-module",
		},
	};

	it("orders child entity refs by the child entity column", () => {
		const orderBy: IncludeEntry["orderBy"] = [
			{
				order: "asc",
				expr: { type: "ref", sourceAlias: "module", field: { type: "system", name: "name" } },
			},
		];
		const query = dialect.sqlToQuery(includeOrderSql(entitySource, orderBy));
		expect(query.sql).toContain("e.name");
		expect(query.sql.toUpperCase()).toContain("ASC");
	});

	it("orders relationship edge refs by the relationship alias", () => {
		const orderBy: IncludeEntry["orderBy"] = [
			{
				order: "desc",
				expr: {
					type: "ref",
					sourceAlias: "courseModule",
					field: { type: "property", schema: "course-module", path: ["position"] },
				},
			},
		];
		const query = dialect.sqlToQuery(includeOrderSql(entitySource, orderBy));
		expect(query.sql).toContain("r.properties");
		expect(query.sql.toUpperCase()).toContain("DESC");
	});
});

describe("eventIncludeOrderSql", () => {
	const eventSource: NestedEventSource = {
		where: null,
		type: "events",
		entityRef: "lesson",
		alias: "completion",
		schemas: ["complete"],
	};

	it("orders event refs by the event column", () => {
		const orderBy: IncludeEntry["orderBy"] = [
			{
				order: "desc",
				expr: {
					type: "ref",
					sourceAlias: "completion",
					field: { type: "system", name: "occurredAt" },
				},
			},
		];
		const query = dialect.sqlToQuery(eventIncludeOrderSql(eventSource, orderBy));
		expect(query.sql).toContain("ev.occurred_at");
		expect(query.sql.toUpperCase()).toContain("DESC");
	});

	it("orders attached-entity refs by the entity column", () => {
		const orderBy: IncludeEntry["orderBy"] = [
			{
				order: "asc",
				expr: { type: "ref", sourceAlias: "lesson", field: { type: "system", name: "name" } },
			},
		];
		const query = dialect.sqlToQuery(eventIncludeOrderSql(eventSource, orderBy));
		expect(query.sql).toContain("e.name");
	});

	it("falls back to a constant for non-ref expressions", () => {
		const orderBy: IncludeEntry["orderBy"] = [
			{ order: "asc", expr: { type: "literal", value: 1 } },
		];
		const query = dialect.sqlToQuery(eventIncludeOrderSql(eventSource, orderBy));
		expect(query.sql.trim()).toBe("1");
	});
});

describe("eventFirstOrderSql", () => {
	const eventSource: NestedEventSource = {
		where: null,
		type: "events",
		entityRef: "lesson",
		alias: "completion",
		schemas: ["complete"],
	};

	it("orders the top-1 event by its own column", () => {
		const orderBy: IncludeEntry["orderBy"] = [
			{
				order: "desc",
				expr: {
					type: "ref",
					sourceAlias: "completion",
					field: { type: "system", name: "occurredAt" },
				},
			},
		];
		const query = dialect.sqlToQuery(eventFirstOrderSql(eventSource, orderBy));
		expect(query.sql).toContain("ev.occurred_at");
		expect(query.sql.toUpperCase()).toContain("DESC");
	});

	it("falls back to a constant when ordering by the anchor entity alias", () => {
		const orderBy: IncludeEntry["orderBy"] = [
			{
				order: "asc",
				expr: { type: "ref", sourceAlias: "lesson", field: { type: "system", name: "name" } },
			},
		];
		const query = dialect.sqlToQuery(eventFirstOrderSql(eventSource, orderBy));
		expect(query.sql.trim()).toBe("1");
	});
});

describe("entityFirstOrderSql", () => {
	const entitySource: EntitySource = {
		where: null,
		alias: "module",
		type: "entities",
		schemas: ["modules"],
		via: {
			entityRef: "course",
			alias: "courseModule",
			direction: "outgoing",
			schema: "course-module",
		},
	};

	it("orders the top-1 child entity by its own column", () => {
		const orderBy: IncludeEntry["orderBy"] = [
			{
				order: "asc",
				expr: { type: "ref", sourceAlias: "module", field: { type: "system", name: "name" } },
			},
		];
		const query = dialect.sqlToQuery(entityFirstOrderSql(entitySource, orderBy));
		expect(query.sql).toContain("e.name");
		expect(query.sql.toUpperCase()).toContain("ASC");
	});

	it("orders the top-1 child entity by the relationship edge alias", () => {
		const orderBy: IncludeEntry["orderBy"] = [
			{
				order: "desc",
				expr: {
					type: "ref",
					sourceAlias: "courseModule",
					field: { type: "property", schema: "course-module", path: ["position"] },
				},
			},
		];
		const query = dialect.sqlToQuery(entityFirstOrderSql(entitySource, orderBy));
		expect(query.sql).toContain("r.properties");
		expect(query.sql.toUpperCase()).toContain("DESC");
	});

	it("falls back to a constant when ordering by the anchor entity alias", () => {
		const orderBy: IncludeEntry["orderBy"] = [
			{
				order: "asc",
				expr: { type: "ref", sourceAlias: "course", field: { type: "system", name: "name" } },
			},
		];
		const query = dialect.sqlToQuery(entityFirstOrderSql(entitySource, orderBy));
		expect(query.sql.trim()).toBe("1");
	});
});
