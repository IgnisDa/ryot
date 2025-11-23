import { describe, expect, it } from "vitest";

import type { QueryDocumentV2 } from "./language";
import { validateQueryDocumentV2 } from "./validator";
import { descendantSource, literal, makeDoc, nameRef, propertyRef } from "./validator.test-support";

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
