import { PgDialect } from "drizzle-orm/pg-core";
import { assert, describe, expect, it } from "vitest";

import {
	evalExprForField,
	evalFieldSelector,
	evalSystemRef,
	exprToOrderSql,
	fieldSelectorToOrderSql,
	getNestedValue,
	serializeRow,
	valueToFieldValue,
	type EntityQueryRow,
} from "./executor";
import type { FieldSelector } from "./language";

const dialect = new PgDialect();

const baseRow: EntityQueryRow = {
	id: "row-1",
	image: null,
	name: "Dune",
	externalId: null,
	totalCount: "42",
	schemaSlug: "books",
	schemaName: "Books",
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
});

describe("evalExprForField", () => {
	it("evaluates a ref expression", () => {
		const result = evalExprForField(
			{ type: "ref", sourceAlias: "e", field: { type: "system", name: "name" } },
			baseRow,
		);
		expect(result).toEqual({ kind: "text", value: "Dune" });
	});

	it("evaluates a literal expression", () => {
		expect(evalExprForField({ type: "literal", value: 99 }, baseRow)).toEqual({
			value: 99,
			kind: "number",
		});
	});

	it("returns null for unsupported expression types", () => {
		expect(
			evalExprForField({ type: "isNull", expr: { type: "literal", value: null } }, baseRow),
		).toEqual({ kind: "null", value: null });
	});
});

describe("serializeRow", () => {
	it("returns an empty object when fields is empty", () => {
		expect(serializeRow(baseRow, [])).toEqual({});
	});

	it("maps field keys to evaluated FieldValues", () => {
		const result = serializeRow(baseRow, [
			{
				key: "title",
				expr: { type: "ref", sourceAlias: "e", field: { type: "system", name: "name" } },
			},
			{ key: "const", expr: { type: "literal", value: "static" } },
		]);
		expect(result).toEqual({
			title: { kind: "text", value: "Dune" },
			const: { kind: "text", value: "static" },
		});
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

	it("uses plain jsonb_extract_path_text for a single-schema property field", () => {
		const query = toSql({ type: "property", schema: "books", path: ["title"] }, ["books"]);
		expect(query.sql.toLowerCase()).toContain("jsonb_extract_path_text");
		expect(query.sql.toLowerCase()).not.toContain("case when");
	});

	it("wraps property in CASE WHEN for multi-schema sources", () => {
		const query = toSql({ type: "property", schema: "books", path: ["title"] }, [
			"books",
			"movies",
		]);
		expect(query.sql.toLowerCase()).toContain("case when");
		expect(query.sql.toLowerCase()).toContain("jsonb_extract_path_text");
	});

	it("returns es.slug for schema 'slug' metadata field", () => {
		const query = toSql({ type: "schema", name: "slug" });
		expect(query.sql).toContain("es.slug");
	});

	it("returns es.name for schema 'name' metadata field", () => {
		const query = toSql({ type: "schema", name: "name" });
		expect(query.sql).toContain("es.name");
	});
});

describe("exprToOrderSql", () => {
	it("returns SQL for a ref expression", () => {
		const result = exprToOrderSql(
			{ type: "ref", sourceAlias: "e", field: { type: "system", name: "name" } },
			["books"],
		);
		assert(result !== null, "expected non-null SQL result");
		expect(dialect.sqlToQuery(result).sql).toContain("e.name");
	});

	it("returns null for a literal expression", () => {
		expect(exprToOrderSql({ type: "literal", value: 1 }, ["books"])).toBeNull();
	});

	it("returns null for other expression types", () => {
		expect(
			exprToOrderSql({ type: "isNull", expr: { type: "literal", value: null } }, ["books"]),
		).toBeNull();
	});
});
