import { describe, expect, it } from "vitest";

import type { Expr, QueryDocumentV2 } from "./language";
import { validateQueryDocumentV2 } from "./validator";

const nameRef = (alias: string): Expr => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "system", name: "name" },
});

const propertyRef = (alias: string, schema: string, path: [string, ...string[]]): Expr => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "property", schema, path },
});

const literal = (value: unknown): Expr => ({ type: "literal", value });

const makeDoc = (overrides: Partial<QueryDocumentV2> = {}): QueryDocumentV2 => ({
	version: 2,
	source: { alias: "e", where: null, type: "entities", schemas: ["books"] },
	return: {
		fields: [],
		type: "rows",
		pagination: { page: 1, limit: 10 },
		orderBy: [{ order: "asc", expr: nameRef("e") }],
	},
	...overrides,
});

describe("alias registration", () => {
	it("accepts a unique alias", () => {
		expect(validateQueryDocumentV2(makeDoc())).toBeNull();
	});
});

describe("schema list validation", () => {
	it("rejects duplicate source schema slugs", () => {
		const doc = makeDoc({
			source: { alias: "e", where: null, type: "entities", schemas: ["books", "books"] },
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Duplicate schema 'books'/);
	});
});

describe("system field validation", () => {
	it.each(["id", "name", "image", "createdAt", "updatedAt", "externalId", "sandboxScriptId"])(
		"accepts valid system field '%s'",
		(name) => {
			const doc = makeDoc({
				return: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					orderBy: [{ order: "asc", expr: nameRef("e") }],
					fields: [
						{ key: "f", expr: { type: "ref", sourceAlias: "e", field: { type: "system", name } } },
					],
				},
			});
			expect(validateQueryDocumentV2(doc)).toBeNull();
		},
	);

	it("rejects an unknown system field name", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "f",
						expr: { type: "ref", sourceAlias: "e", field: { type: "system", name: "nonexistent" } },
					},
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Invalid system field 'nonexistent'/);
	});

	it("rejects an invalid system field in orderBy", () => {
		const doc = makeDoc({
			return: {
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [
					{
						order: "asc",
						expr: { type: "ref", sourceAlias: "e", field: { type: "system", name: "bogus" } },
					},
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Invalid system field 'bogus'/);
	});
});

describe("property field schema validation", () => {
	it("accepts a property field whose schema is in the source schemas", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "title", expr: propertyRef("e", "books", ["title"]) }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("rejects a property field whose schema is not in the source schemas", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "title", expr: propertyRef("e", "movies", ["title"]) }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/schema 'movies'.*not in source schemas/);
	});

	it("accepts a property field in a multi-schema source when schema is listed", () => {
		const doc: QueryDocumentV2 = {
			version: 2,
			source: { type: "entities", alias: "e", schemas: ["books", "movies"], where: null },
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "title", expr: propertyRef("e", "movies", ["title"]) }],
			},
		};
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("rejects a property field that references a third schema in a multi-schema source", () => {
		const doc: QueryDocumentV2 = {
			version: 2,
			source: { type: "entities", alias: "e", schemas: ["books", "movies"], where: null },
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "title", expr: propertyRef("e", "music", ["title"]) }],
			},
		};
		expect(validateQueryDocumentV2(doc)).toMatch(/schema 'music'.*not in source schemas/);
	});
});

describe("pagination limit", () => {
	it("accepts limit of 100", () => {
		const doc = makeDoc({
			return: {
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 100 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("rejects limit of 101", () => {
		const doc = makeDoc({
			return: {
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 101 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/101.*exceeds maximum of 100/);
	});
});

describe("output field key uniqueness", () => {
	it("accepts distinct field keys", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{ key: "a", expr: nameRef("e") },
					{ key: "b", expr: nameRef("e") },
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("rejects duplicate output field keys", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{ key: "title", expr: nameRef("e") },
					{ key: "title", expr: nameRef("e") },
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Duplicate output field key 'title'/);
	});
});

describe("unknown source alias", () => {
	it("rejects an orderBy ref to an unknown alias", () => {
		const doc = makeDoc({
			return: {
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("unknown") }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'unknown'/);
	});

	it("rejects a field ref to an unknown alias", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "f", expr: nameRef("ghost") }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'ghost'/);
	});
});

describe("expression validation coverage", () => {
	it("accepts literal expressions in fields", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "const", expr: literal("hello") }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("validates both sides of a comparison expression", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "cmp",
						expr: {
							operator: "eq",
							type: "comparison",
							left: nameRef("e"),
							right: nameRef("bad"),
						},
					},
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'bad'/);
	});

	it("validates all values in an 'and' expression", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "f", expr: { type: "and", values: [nameRef("e"), nameRef("missing")] } }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'missing'/);
	});

	it("validates nested expr inside 'not'", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "f", expr: { type: "not", expr: nameRef("ghost") } }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'ghost'/);
	});

	it("validates nested expr inside 'isNull'", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "f", expr: { type: "isNull", expr: nameRef("ghost") } }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'ghost'/);
	});

	it("validates nested expr inside 'isNotNull'", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "f", expr: { type: "isNotNull", expr: nameRef("ghost") } }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'ghost'/);
	});

	it("validates both sides of a 'contains' expression", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{ key: "f", expr: { type: "contains", left: nameRef("e"), right: nameRef("bad") } },
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'bad'/);
	});

	it("validates all values in a 'coalesce' expression", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{ key: "f", expr: { type: "coalesce", values: [literal("default"), nameRef("bad")] } },
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'bad'/);
	});
});

describe("source where clause", () => {
	it("accepts null where clause", () => {
		expect(validateQueryDocumentV2(makeDoc())).toBeNull();
	});

	it("validates the where expression when non-null", () => {
		const doc: QueryDocumentV2 = {
			version: 2,
			source: {
				alias: "e",
				type: "entities",
				schemas: ["books"],
				where: { type: "isNull", expr: nameRef("ghost") },
			},
			return: {
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
			},
		};
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'ghost'/);
	});

	it("accepts a valid where expression", () => {
		const doc: QueryDocumentV2 = {
			version: 2,
			source: {
				alias: "e",
				type: "entities",
				schemas: ["books"],
				where: { type: "isNull", expr: nameRef("e") },
			},
			return: {
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
			},
		};
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});
});

describe("schema metadata fields", () => {
	it("accepts schema 'slug' field", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "slug",
						expr: { type: "ref", sourceAlias: "e", field: { type: "schema", name: "slug" } },
					},
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("accepts schema 'name' field", () => {
		const doc = makeDoc({
			return: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "sn",
						expr: { type: "ref", sourceAlias: "e", field: { type: "schema", name: "name" } },
					},
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});
});
