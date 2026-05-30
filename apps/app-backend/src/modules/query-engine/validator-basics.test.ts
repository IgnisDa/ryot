import { describe, expect, it } from "vitest";

import type { QueryDocument } from "./language";
import { validateQueryDocument } from "./validator";
import { makeDoc, nameRef, propertyRef } from "./validator.test-support";

describe("alias registration", () => {
	it("accepts a unique alias", () => {
		expect(validateQueryDocument(makeDoc())).toBeNull();
	});
});

describe("schema list validation", () => {
	it("rejects duplicate source schema slugs", () => {
		const doc = makeDoc({
			source: { alias: "e", where: null, type: "entities", schemas: ["books", "books"] },
		});
		expect(validateQueryDocument(doc)).toMatch(/Duplicate schema 'books'/);
	});
});

describe("system field validation", () => {
	it.each([
		"id",
		"name",
		"userId",
		"createdAt",
		"updatedAt",
		"externalId",
		"populatedAt",
		"properties",
		"entitySchemaId",
		"sandboxScriptId",
	])("accepts valid system field '%s'", (name) => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{ key: "f", expr: { type: "ref", sourceAlias: "e", field: { type: "system", name } } },
				],
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("rejects an unknown system field name", () => {
		const doc = makeDoc({
			output: {
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
		expect(validateQueryDocument(doc)).toMatch(/Invalid system field 'nonexistent'/);
	});

	it("rejects an invalid system field in orderBy", () => {
		const doc = makeDoc({
			output: {
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
		expect(validateQueryDocument(doc)).toMatch(/Invalid system field 'bogus'/);
	});
});

describe("property field schema validation", () => {
	it("accepts a property field whose schema is in the source schemas", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "title", expr: propertyRef("e", "books", ["title"]) }],
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("rejects a property field whose schema is not in the source schemas", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "title", expr: propertyRef("e", "movies", ["title"]) }],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/schema 'movies'.*not in source schemas/);
	});

	it("accepts a property field in a multi-schema source when schema is listed", () => {
		const doc: QueryDocument = {
			source: { type: "entities", alias: "e", schemas: ["books", "movies"], where: null },
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "title", expr: propertyRef("e", "movies", ["title"]) }],
			},
		};
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("rejects a property field that references a third schema in a multi-schema source", () => {
		const doc: QueryDocument = {
			source: { type: "entities", alias: "e", schemas: ["books", "movies"], where: null },
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "title", expr: propertyRef("e", "music", ["title"]) }],
			},
		};
		expect(validateQueryDocument(doc)).toMatch(/schema 'music'.*not in source schemas/);
	});
});

describe("pagination limit", () => {
	it("accepts limit of 100", () => {
		const doc = makeDoc({
			output: {
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 100 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("rejects limit of 101", () => {
		const doc = makeDoc({
			output: {
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 101 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/101.*exceeds maximum of 100/);
	});
});

describe("output field key uniqueness", () => {
	it("accepts distinct field keys", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{ key: "a", expr: nameRef("e") },
					{ key: "b", expr: nameRef("e") },
				],
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("rejects duplicate output field keys", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{ key: "title", expr: nameRef("e") },
					{ key: "title", expr: nameRef("e") },
				],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/Duplicate output field key 'title'/);
	});
});

describe("unknown source alias", () => {
	it("rejects an orderBy ref to an unknown alias", () => {
		const doc = makeDoc({
			output: {
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("unknown") }],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/Unknown source alias 'unknown'/);
	});

	it("rejects a field ref to an unknown alias", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [{ key: "f", expr: nameRef("ghost") }],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/Unknown source alias 'ghost'/);
	});
});
