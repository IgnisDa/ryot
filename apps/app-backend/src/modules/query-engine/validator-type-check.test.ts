import type { Expr, QueryDocument } from "@ryot/contract/modules/query-engine/language";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { describe, expect, it } from "vitest";

import { literal, makeDoc, nameRef, propertyRef } from "./validator.test-support";
import { collectAliasScope } from "./validator/document";
import { checkQueryDocumentTypes, type PropertySchemasBySlug } from "./validator/type-check";

const booksSchema: AppSchema = {
	fields: {
		title: { type: "string", label: "Title", description: "Title" },
		pageCount: { type: "integer", label: "Pages", description: "Pages" },
		releasedAt: { type: "date", label: "Released", description: "Released" },
	},
};

const propertiesBySlug: PropertySchemasBySlug = new Map([["books", booksSchema]]);

const checkWhere = (where: Expr, props: PropertySchemasBySlug = propertiesBySlug) => {
	const doc: QueryDocument = makeDoc({
		source: { alias: "e", where, type: "entities", schemas: ["books"] },
	});
	return checkQueryDocumentTypes(collectAliasScope(doc), doc, props);
};

const comparison = (operator: "gt" | "lt" | "gte" | "eq", left: Expr, right: Expr): Expr => ({
	left,
	right,
	operator,
	type: "comparison",
});

describe("ordering comparisons", () => {
	it("rejects ordering a string property against a number literal", () => {
		const error = checkWhere(comparison("gt", propertyRef("e", "books", ["title"]), literal(5)));
		expect(error).toMatch(/Comparison operands are not type-compatible/);
	});

	it("allows ordering a number property against a number literal", () => {
		expect(
			checkWhere(comparison("gte", propertyRef("e", "books", ["pageCount"]), literal(10))),
		).toBeNull();
	});

	it("allows ordering a date property against a string literal", () => {
		expect(
			checkWhere(
				comparison("lt", propertyRef("e", "books", ["releasedAt"]), literal("2026-01-01")),
			),
		).toBeNull();
	});

	it("allows ordering against an unknown-typed property", () => {
		const emptySchema: AppSchema = { fields: {} };
		const error = checkWhere(
			comparison("gt", propertyRef("e", "books", ["missing"]), literal(5)),
			new Map([["books", emptySchema]]),
		);
		expect(error).toBeNull();
	});
});

describe("equality comparisons", () => {
	it("allows eq across mismatched known types", () => {
		expect(
			checkWhere(comparison("eq", propertyRef("e", "books", ["title"]), literal(5))),
		).toBeNull();
	});
});

describe("arithmetic operands", () => {
	it("allows numeric arithmetic operands", () => {
		const arithmetic: Expr = {
			type: "arithmetic",
			operator: "add",
			left: propertyRef("e", "books", ["pageCount"]),
			right: literal(2),
		};
		expect(
			checkWhere(comparison("gt", arithmetic, propertyRef("e", "books", ["pageCount"]))),
		).toBeNull();
	});

	it("rejects arithmetic with a string operand", () => {
		const arithmetic: Expr = {
			type: "arithmetic",
			operator: "multiply",
			left: propertyRef("e", "books", ["title"]),
			right: literal(2),
		};
		const error = checkWhere({ type: "isNotNull", expr: arithmetic });
		expect(error).toMatch(/Arithmetic operands must be numeric/);
	});
});

describe("contains operands", () => {
	it("rejects contains over two numbers", () => {
		const error = checkWhere({
			type: "contains",
			left: propertyRef("e", "books", ["pageCount"]),
			right: literal(3),
		});
		expect(error).toMatch(/Contains operands are not type-compatible/);
	});

	it("allows contains over two strings", () => {
		expect(
			checkWhere({
				type: "contains",
				left: propertyRef("e", "books", ["title"]),
				right: literal("foo"),
			}),
		).toBeNull();
	});
});

describe("new entity system field types", () => {
	it("allows ordering a populatedAt date field against a date literal", () => {
		expect(
			checkWhere(
				comparison(
					"lt",
					{ type: "ref", sourceAlias: "e", field: { type: "system", name: "populatedAt" } },
					{ type: "literal", value: "2026-01-01", valueType: "date" },
				),
			),
		).toBeNull();
	});

	it("rejects ordering a userId string field against a number literal", () => {
		const error = checkWhere(
			comparison(
				"gt",
				{ type: "ref", sourceAlias: "e", field: { type: "system", name: "userId" } },
				literal(5),
			),
		);
		expect(error).toMatch(/Comparison operands are not type-compatible/);
	});

	it("treats properties as unknown and does not reject ordering", () => {
		expect(
			checkWhere(
				comparison(
					"gt",
					{ type: "ref", sourceAlias: "e", field: { type: "system", name: "properties" } },
					literal(5),
				),
			),
		).toBeNull();
	});
});

describe("new event system field types", () => {
	const checkEventWhere = (where: Expr) => {
		const doc: QueryDocument = {
			source: {
				where,
				alias: "ev",
				type: "events",
				schemas: ["complete"],
				entity: { alias: "ent", schemas: ["books"] },
			},
			output: {
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("ent") }],
			},
		};
		return checkQueryDocumentTypes(collectAliasScope(doc), doc, propertiesBySlug);
	};

	it("allows comparing eventSchemaId string against a string literal", () => {
		expect(
			checkEventWhere(
				comparison(
					"eq",
					{ type: "ref", sourceAlias: "ev", field: { type: "system", name: "eventSchemaId" } },
					literal("schema-1"),
				),
			),
		).toBeNull();
	});

	it("rejects ordering entityId string against a number literal", () => {
		const error = checkEventWhere(
			comparison(
				"gt",
				{ type: "ref", sourceAlias: "ev", field: { type: "system", name: "entityId" } },
				literal(5),
			),
		);
		expect(error).toMatch(/Comparison operands are not type-compatible/);
	});

	it("treats event properties as unknown and does not reject ordering", () => {
		expect(
			checkEventWhere(
				comparison(
					"gt",
					{ type: "ref", sourceAlias: "ev", field: { type: "system", name: "properties" } },
					literal(5),
				),
			),
		).toBeNull();
	});
});

describe("conservative source coverage", () => {
	it("treats event property operands as unknown", () => {
		const doc: QueryDocument = {
			source: {
				where: null,
				type: "events",
				alias: "lesson",
				schemas: ["complete"],
				entity: { alias: "course", schemas: ["books"] },
			},
			output: {
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("course") }],
			},
		};
		const where: Expr = comparison(
			"gt",
			{
				type: "ref",
				sourceAlias: "lesson",
				field: { type: "property", schema: "complete", path: ["score"] },
			},
			literal(5),
		);
		const withWhere: QueryDocument = { ...doc, source: { ...doc.source, where } };
		expect(
			checkQueryDocumentTypes(collectAliasScope(withWhere), withWhere, propertiesBySlug),
		).toBeNull();
	});
});
