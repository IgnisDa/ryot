import { describe, expect, it } from "vitest";

import type { EntitySourceV2, Expr, IncludeEntryV2, QueryDocumentV2 } from "./language";
import { validateQueryDocumentV2 } from "./validator";

type RowsQueryDocumentV2 = QueryDocumentV2 & {
	output: Extract<QueryDocumentV2["output"], { type: "rows" }>;
};

const nameRef = (alias: string): Expr => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "system", name: "name" },
});

const occurredAtRef = (alias: string): Expr => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "system", name: "occurredAt" },
});

const propertyRef = (alias: string, schema: string, path: [string, ...string[]]): Expr => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "property", schema, path },
});

const literal = (value: unknown): Expr => ({ type: "literal", value });

const descendantSource = (
	alias: string,
	anchor: string,
	edgeAlias: string,
	where: Expr | null,
): EntitySourceV2 => ({
	where,
	alias,
	type: "entities",
	schemas: [`${alias}s`],
	via: { entityRef: anchor, alias: edgeAlias, direction: "outgoing", schema: edgeAlias },
});

const makeDoc = (overrides: Partial<RowsQueryDocumentV2> = {}): RowsQueryDocumentV2 => ({
	version: 2,
	source: { alias: "e", where: null, type: "entities", schemas: ["books"] },
	output: {
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
				output: {
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
		expect(validateQueryDocumentV2(doc)).toMatch(/Invalid system field 'nonexistent'/);
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
		expect(validateQueryDocumentV2(doc)).toMatch(/Invalid system field 'bogus'/);
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
		expect(validateQueryDocumentV2(doc)).toBeNull();
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
		expect(validateQueryDocumentV2(doc)).toMatch(/schema 'movies'.*not in source schemas/);
	});

	it("accepts a property field in a multi-schema source when schema is listed", () => {
		const doc: QueryDocumentV2 = {
			version: 2,
			source: { type: "entities", alias: "e", schemas: ["books", "movies"], where: null },
			output: {
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
			output: {
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
			output: {
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
			output: {
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
		expect(validateQueryDocumentV2(doc)).toBeNull();
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
		expect(validateQueryDocumentV2(doc)).toMatch(/Duplicate output field key 'title'/);
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
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'unknown'/);
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
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'ghost'/);
	});
});

describe("expression validation coverage", () => {
	it("accepts literal expressions in fields", () => {
		const doc = makeDoc({
			output: {
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
			output: {
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
			output: {
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
			output: {
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
			output: {
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
			output: {
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
			output: {
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
			output: {
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

	it("accepts a non-null root entity where clause", () => {
		const doc: QueryDocumentV2 = {
			version: 2,
			source: {
				alias: "e",
				type: "entities",
				schemas: ["books"],
				where: { type: "isNull", expr: nameRef("ghost") },
			},
			output: {
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
			},
		};
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'ghost'/);
	});

	it("accepts a valid root entity where expression", () => {
		const doc: QueryDocumentV2 = {
			version: 2,
			source: {
				alias: "e",
				type: "entities",
				schemas: ["books"],
				where: { type: "isNull", expr: nameRef("e") },
			},
			output: {
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
			},
		};
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("accepts nested exists over descendant entity sources", () => {
		const doc = makeDoc({
			output: { ...makeDoc().output, orderBy: [{ order: "asc", expr: nameRef("course") }] },
			source: {
				alias: "course",
				type: "entities",
				schemas: ["courses"],
				where: {
					type: "exists",
					source: {
						type: "entities",
						alias: "module",
						schemas: ["modules"],
						via: {
							entityRef: "course",
							alias: "courseModule",
							direction: "outgoing",
							schema: "course-module",
						},
						where: {
							type: "exists",
							source: {
								where: {
									operator: "gt",
									type: "comparison",
									right: literal(60),
									left: propertyRef("lesson", "lessons", ["durationMinutes"]),
								},
								type: "entities",
								alias: "lesson",
								schemas: ["lessons"],
								via: {
									entityRef: "module",
									alias: "moduleLesson",
									direction: "outgoing",
									schema: "module-lesson",
								},
							},
						},
					},
				},
			},
		});

		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("accepts aggregate expressions over descendant sources", () => {
		const doc = makeDoc({
			output: { ...makeDoc().output, orderBy: [{ order: "asc", expr: nameRef("course") }] },
			source: {
				alias: "course",
				type: "entities",
				schemas: ["courses"],
				where: {
					operator: "gt",
					type: "comparison",
					right: literal(2),
					left: {
						aggregation: { function: "count" },
						type: "aggregate",
						source: {
							where: null,
							type: "entities",
							alias: "module",
							schemas: ["modules"],
							via: {
								entityRef: "course",
								alias: "courseModule",
								direction: "outgoing",
								schema: "course-module",
							},
						},
					},
				},
			},
		});

		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("rejects expression source depth greater than 3", () => {
		const doc = makeDoc({
			output: { ...makeDoc().output, orderBy: [{ order: "asc", expr: nameRef("course") }] },
			source: {
				alias: "course",
				type: "entities",
				schemas: ["courses"],
				where: {
					type: "exists",
					source: descendantSource("module", "course", "courseModule", {
						type: "exists",
						source: descendantSource("lesson", "module", "moduleLesson", {
							type: "exists",
							source: descendantSource("part", "lesson", "lessonPart", {
								type: "exists",
								source: descendantSource("segment", "part", "partSegment", null),
							}),
						}),
					}),
				},
			},
		});

		expect(validateQueryDocumentV2(doc)).toMatch(/Expression source depth exceeds maximum of 3/);
	});
});

describe("schema metadata fields", () => {
	it("accepts schema 'slug' field", () => {
		const doc = makeDoc({
			output: {
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
			output: {
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

describe("event roots and first expressions", () => {
	const makeEventDoc = (overrides: Partial<QueryDocumentV2> = {}): QueryDocumentV2 => ({
		version: 2,
		source: {
			where: null,
			type: "events",
			alias: "completion",
			schemas: ["complete"],
			entity: { alias: "lesson", schemas: ["lessons"] },
		},
		output: {
			fields: [],
			type: "rows",
			pagination: { page: 1, limit: 10 },
			orderBy: [{ order: "desc", expr: occurredAtRef("completion") }],
		},
		...overrides,
	});

	it("accepts a root event source with an attached entity alias", () => {
		expect(validateQueryDocumentV2(makeEventDoc())).toBeNull();
	});

	it("accepts event, event property, attached entity, and event schema metadata refs", () => {
		const doc = makeEventDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "desc", expr: occurredAtRef("completion") }],
				fields: [
					{ key: "occurredAt", expr: occurredAtRef("completion") },
					{ key: "notes", expr: propertyRef("completion", "complete", ["notes"]) },
					{ key: "lessonName", expr: nameRef("lesson") },
					{
						key: "eventSchemaSlug",
						expr: {
							type: "ref",
							sourceAlias: "completion",
							field: { type: "schema", name: "slug" },
						},
					},
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("rejects duplicate root event and attached entity aliases", () => {
		const doc = makeEventDoc({
			source: {
				where: null,
				type: "events",
				alias: "completion",
				schemas: ["complete"],
				entity: { alias: "completion", schemas: ["lessons"] },
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Duplicate alias 'completion'/);
	});

	it("accepts first over an ordered event source", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "latestCompletion",
						expr: {
							type: "first",
							select: occurredAtRef("completion"),
							orderBy: [{ order: "desc", expr: occurredAtRef("completion") }],
							source: {
								where: null,
								type: "events",
								alias: "completion",
								entityRef: "e",
								schemas: ["complete"],
							},
						},
					},
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("rejects invalid aliases inside first", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "latestCompletion",
						expr: {
							type: "first",
							select: occurredAtRef("ghost"),
							orderBy: [{ order: "desc", expr: occurredAtRef("completion") }],
							source: {
								where: null,
								type: "events",
								alias: "completion",
								entityRef: "e",
								schemas: ["complete"],
							},
						},
					},
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'ghost'/);
	});

	it("rejects unsupported first orderBy expressions", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "latestCompletion",
						expr: {
							type: "first",
							select: occurredAtRef("completion"),
							orderBy: [{ order: "desc", expr: literal(1) }],
							source: {
								where: null,
								type: "events",
								alias: "completion",
								entityRef: "e",
								schemas: ["complete"],
							},
						},
					},
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/First orderBy currently supports ref/);
	});

	it("rejects unsupported first select expressions", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "latestCompletion",
						expr: {
							type: "first",
							orderBy: [{ order: "desc", expr: occurredAtRef("completion") }],
							select: { type: "coalesce", values: [occurredAtRef("completion"), literal(null)] },
							source: {
								where: null,
								type: "events",
								alias: "completion",
								entityRef: "e",
								schemas: ["complete"],
							},
						},
					},
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/First select currently supports ref and literal/);
	});

	it("rejects first in root orderBy", () => {
		const firstExpr: Expr = {
			type: "first",
			select: occurredAtRef("completion"),
			orderBy: [{ order: "desc", expr: occurredAtRef("completion") }],
			source: {
				where: null,
				type: "events",
				entityRef: "e",
				alias: "completion",
				schemas: ["complete"],
			},
		};
		const doc = makeDoc({
			output: {
				fields: [],
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: firstExpr }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/First expressions are currently valid only/);
	});

	it("rejects first nested inside a computed output expression", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "latestCompletion",
						expr: {
							type: "coalesce",
							values: [
								{
									type: "first",
									select: occurredAtRef("completion"),
									orderBy: [{ order: "desc", expr: occurredAtRef("completion") }],
									source: {
										where: null,
										type: "events",
										entityRef: "e",
										alias: "completion",
										schemas: ["complete"],
									},
								},
								literal(null),
							],
						},
					},
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/First expressions are currently valid only/);
	});
});

describe("relationship includes", () => {
	const moduleInclude = (overrides: Partial<IncludeEntryV2> = {}): IncludeEntryV2 => {
		const base: IncludeEntryV2 = {
			limit: 10,
			key: "modules",
			fields: [{ key: "name", expr: nameRef("module") }],
			orderBy: [{ order: "asc", expr: propertyRef("module", "modules", ["moduleNumber"]) }],
			source: {
				where: null,
				alias: "module",
				type: "entities",
				schemas: ["modules"],
				via: {
					entityRef: "e",
					direction: "outgoing",
					alias: "courseModule",
					schema: "course-module",
				},
			},
		};
		return { ...base, ...overrides };
	};

	const lessonInclude = (overrides: Partial<IncludeEntryV2> = {}): IncludeEntryV2 => {
		const base: IncludeEntryV2 = {
			limit: 10,
			key: "lessons",
			fields: [{ key: "name", expr: nameRef("lesson") }],
			orderBy: [{ order: "asc", expr: propertyRef("lesson", "lessons", ["lessonNumber"]) }],
			source: {
				where: null,
				alias: "lesson",
				type: "entities",
				schemas: ["lessons"],
				via: {
					entityRef: "module",
					alias: "moduleLesson",
					direction: "outgoing",
					schema: "module-lesson",
				},
			},
		};
		return { ...base, ...overrides };
	};

	it("accepts a one-hop entity include", () => {
		const doc = makeDoc({ output: { ...makeDoc().output, include: [moduleInclude()] } });
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("accepts nested entity includes", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [moduleInclude({ include: [lessonInclude()] })],
			},
		});
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("accepts exists over an event source attached to the included entity", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						include: [
							lessonInclude({
								fields: [
									{
										key: "isComplete",
										expr: {
											type: "exists",
											source: {
												where: null,
												type: "events",
												alias: "completion",
												entityRef: "lesson",
												schemas: ["complete"],
											},
										},
									},
								],
							}),
						],
					}),
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("rejects include depth greater than 3", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						include: [
							lessonInclude({
								include: [
									lessonInclude({
										key: "parts",
										fields: [{ key: "name", expr: nameRef("part") }],
										orderBy: [{ order: "asc", expr: nameRef("part") }],
										source: {
											...lessonInclude().source,
											alias: "part",
											schemas: ["parts"],
											via: {
												entityRef: "lesson",
												alias: "lessonPart",
												direction: "outgoing",
												schema: "lesson-part",
											},
										},
										include: [
											lessonInclude({
												key: "segments",
												fields: [{ key: "name", expr: nameRef("segment") }],
												orderBy: [{ order: "asc", expr: nameRef("segment") }],
												source: {
													...lessonInclude().source,
													alias: "segment",
													schemas: ["segments"],
													via: {
														entityRef: "part",
														alias: "partSegment",
														direction: "outgoing",
														schema: "part-segment",
													},
												},
											}),
										],
									}),
								],
							}),
						],
					}),
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Include depth exceeds maximum of 3/);
	});

	it("accepts relationship edge fields in include output", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						fields: [
							{ key: "name", expr: nameRef("module") },
							{ key: "position", expr: propertyRef("courseModule", "course-module", ["position"]) },
						],
					}),
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("rejects include limit above 100", () => {
		const doc = makeDoc({
			output: { ...makeDoc().output, include: [moduleInclude({ limit: 101 })] },
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Include limit 101 exceeds maximum of 100/);
	});

	it("rejects an include source without via", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						source: { alias: "module", type: "entities", schemas: ["modules"], where: null },
					}),
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/must specify via/);
	});

	it("rejects an include source where clause until include filtering is executable", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						source: { ...moduleInclude().source, where: nameRef("module") },
					}),
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/does not support where yet/);
	});

	it("rejects via entityRef outside scope", () => {
		const baseInclude = moduleInclude();
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						source: {
							...baseInclude.source,
							via: {
								alias: "courseModule",
								schema: "course-module",
								entityRef: "ghost",
								direction: "outgoing",
							},
						},
					}),
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'ghost'/);
	});

	it("rejects sibling include aliases as traversal anchors", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude(),
					moduleInclude({
						key: "lessons",
						fields: [{ key: "name", expr: nameRef("lesson") }],
						orderBy: [{ order: "asc", expr: propertyRef("lesson", "lessons", ["lessonNumber"]) }],
						source: {
							where: null,
							alias: "lesson",
							type: "entities",
							schemas: ["lessons"],
							via: {
								entityRef: "module",
								alias: "moduleLesson",
								direction: "outgoing",
								schema: "module-lesson",
							},
						},
					}),
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'module'/);
	});

	it("rejects duplicate aliases across sibling includes", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [moduleInclude(), moduleInclude({ key: "otherModules" })],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Duplicate alias 'courseModule'/);
	});

	it("rejects duplicate field and include keys", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				fields: [{ key: "modules", expr: nameRef("e") }],
				include: [moduleInclude()],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Duplicate output field key 'modules'/);
	});

	it("rejects via on a root entity source", () => {
		const doc = makeDoc({ source: moduleInclude().source });
		expect(validateQueryDocumentV2(doc)).toMatch(/Root entity source cannot specify via/);
	});
});
