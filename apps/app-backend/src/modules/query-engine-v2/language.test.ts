import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { Expr, FieldSelector, QueryDocumentV2, RowsOutputV2 } from "./language";

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

	it("throws when a field selector has an excess property", () => {
		expect(() => decodeSync(FieldSelector)({ type: "system", name: "id", path: ["id"] })).toThrow();
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

describe("RowsOutputV2", () => {
	it("decodes a minimal rows output with no fields", () => {
		const result = decodeSync(RowsOutputV2)({
			fields: [],
			type: "rows",
			pagination: { page: 1, limit: 10 },
			orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
		});
		expect(result.type).toBe("rows");
		expect(result.fields).toHaveLength(0);
	});

	it("decodes fields array with multiple entries", () => {
		const result = decodeSync(RowsOutputV2)({
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
			decodeSync(RowsOutputV2)({
				fields: [],
				orderBy: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
			}),
		).toThrow();
	});

	it("throws when pagination page is zero", () => {
		expect(() =>
			decodeSync(RowsOutputV2)({
				fields: [],
				type: "rows",
				pagination: { page: 0, limit: 10 },
				orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
			}),
		).toThrow();
	});

	it("throws when pagination limit is zero", () => {
		expect(() =>
			decodeSync(RowsOutputV2)({
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 0 },
				orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
			}),
		).toThrow();
	});

	it("throws when fields are missing", () => {
		expect(() =>
			decodeSync(RowsOutputV2)({
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
			}),
		).toThrow();
	});

	it("throws when pagination is missing", () => {
		expect(() =>
			decodeSync(RowsOutputV2)({
				fields: [],
				type: "rows",
				orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
			}),
		).toThrow();
	});

	it("decodes an entity include with relationship traversal", () => {
		const result = decodeSync(RowsOutputV2)({
			fields: [],
			type: "rows",
			pagination: { page: 1, limit: 10 },
			orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
			include: [
				{
					limit: 20,
					key: "modules",
					fields: [
						{
							key: "name",
							expr: { type: "ref", sourceAlias: "module", field: { type: "system", name: "name" } },
						},
					],
					orderBy: [
						{
							order: "asc",
							expr: { type: "ref", sourceAlias: "module", field: { type: "system", name: "name" } },
						},
					],
					source: {
						where: null,
						alias: "module",
						type: "entities",
						schemas: ["module"],
						via: {
							entityRef: "course",
							direction: "outgoing",
							alias: "courseModule",
							schema: "course-module",
						},
					},
				},
			],
		});

		expect(result.include).toHaveLength(1);
		expect(result.include?.[0]?.source.via?.schema).toBe("course-module");
	});

	it("decodes nested entity includes", () => {
		const result = decodeSync(RowsOutputV2)({
			fields: [],
			type: "rows",
			pagination: { page: 1, limit: 10 },
			orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
			include: [
				{
					limit: 20,
					fields: [],
					key: "modules",
					orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
					source: {
						where: null,
						alias: "module",
						type: "entities",
						schemas: ["module"],
						via: {
							entityRef: "course",
							alias: "courseModule",
							direction: "outgoing",
							schema: "course-module",
						},
					},
					include: [
						{
							limit: 20,
							fields: [],
							key: "lessons",
							orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
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
						},
					],
				},
			],
		});

		expect(result.include?.[0]?.include).toHaveLength(1);
	});

	it("throws when an include is missing a limit", () => {
		expect(() =>
			decodeSync(RowsOutputV2)({
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
				include: [
					{
						fields: [],
						key: "modules",
						orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
						source: { type: "entities", alias: "module", schemas: ["module"], where: null },
					},
				],
			}),
		).toThrow();
	});
});

describe("QueryDocumentV2", () => {
	const minimal = {
		version: 2,
		source: { type: "entities", alias: "e", schemas: ["books"], where: null },
		output: {
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

	it("decodes a root event source document", () => {
		const result = decodeSync(QueryDocumentV2)({
			...minimal,
			source: {
				where: null,
				type: "events",
				alias: "completion",
				schemas: ["complete"],
				entity: { alias: "lesson", schemas: ["lesson"] },
			},
			output: {
				...minimal.output,
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
			},
		});

		expect(result.source.type).toBe("events");
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

	it("throws when a source has an unsupported filter key", () => {
		expect(() =>
			decodeSync(QueryDocumentV2)({
				...minimal,
				source: { ...minimal.source, filter: { type: "literal", value: true } },
			}),
		).toThrow();
	});
});
