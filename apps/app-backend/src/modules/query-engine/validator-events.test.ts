import { describe, expect, it } from "vitest";

import type { Expr, QueryDocument } from "./language";
import {
	descendantSource,
	literal,
	makeDoc,
	nameRef,
	occurredAtRef,
	propertyRef,
} from "./validator.test-support";
import { validateQueryDocument } from "./validator/document";

const makeEventDoc = (overrides: Partial<QueryDocument> = {}): QueryDocument => ({
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

describe("event roots and first expressions", () => {
	it("accepts a root event source with an attached entity alias", () => {
		expect(validateQueryDocument(makeEventDoc())).toBeNull();
	});

	it.each(["entityId", "eventSchemaId", "sessionEntityId", "userId", "properties"])(
		"accepts event system field '%s' in fields and orderBy",
		(name) => {
			const doc = makeEventDoc({
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					orderBy: [
						{
							order: "desc",
							expr: { type: "ref", sourceAlias: "completion", field: { type: "system", name } },
						},
					],
					fields: [
						{
							key: "f",
							expr: { type: "ref", sourceAlias: "completion", field: { type: "system", name } },
						},
					],
				},
			});
			expect(validateQueryDocument(doc)).toBeNull();
		},
	);

	it("accepts a new event system field inside a where comparison", () => {
		const doc = makeEventDoc({
			source: {
				where: null,
				type: "events",
				alias: "completion",
				schemas: ["complete"],
				entity: { alias: "lesson", schemas: ["lessons"] },
			},
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "desc", expr: occurredAtRef("completion") }],
				fields: [
					{
						key: "hasSession",
						expr: {
							type: "isNotNull",
							expr: {
								type: "ref",
								sourceAlias: "completion",
								field: { type: "system", name: "sessionEntityId" },
							},
						},
					},
				],
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
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
		expect(validateQueryDocument(doc)).toBeNull();
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
		expect(validateQueryDocument(doc)).toMatch(/Duplicate alias 'completion'/);
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
		expect(validateQueryDocument(doc)).toBeNull();
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
		expect(validateQueryDocument(doc)).toMatch(/Unknown source alias 'ghost'/);
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
		expect(validateQueryDocument(doc)).toMatch(/First orderBy currently supports ref/);
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
		expect(validateQueryDocument(doc)).toMatch(/First select currently supports ref and literal/);
	});

	it("rejects first as a root orderBy expression", () => {
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
		expect(validateQueryDocument(doc)).toMatch(/Rows orderBy currently supports ref/);
	});

	it("accepts first nested inside a computed output expression", () => {
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
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("accepts first over a descendant entity source", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "firstModuleName",
						expr: {
							type: "first",
							select: nameRef("module"),
							orderBy: [{ order: "asc", expr: propertyRef("module", "modules", ["position"]) }],
							source: descendantSource("module", "e", "courseModule", null),
						},
					},
				],
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("accepts first ordering and selecting by the edge alias of an entity source", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "firstByEdge",
						expr: {
							type: "first",
							select: propertyRef("courseModule", "courseModule", ["position"]),
							orderBy: [
								{ order: "asc", expr: propertyRef("courseModule", "courseModule", ["position"]) },
							],
							source: descendantSource("module", "e", "courseModule", null),
						},
					},
				],
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("accepts first used inside a where clause", () => {
		const doc = makeDoc({
			source: {
				alias: "e",
				type: "entities",
				schemas: ["books"],
				where: {
					operator: "gt",
					type: "comparison",
					right: literal(0),
					left: {
						type: "first",
						select: propertyRef("module", "modules", ["position"]),
						orderBy: [{ order: "asc", expr: propertyRef("module", "modules", ["position"]) }],
						source: descendantSource("module", "e", "courseModule", null),
					},
				},
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("rejects first whose source carries a where clause", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "firstModuleName",
						expr: {
							type: "first",
							select: nameRef("module"),
							orderBy: [{ order: "asc", expr: nameRef("module") }],
							source: descendantSource("module", "e", "courseModule", {
								type: "isNotNull",
								expr: nameRef("module"),
							}),
						},
					},
				],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/First expression source does not support where/);
	});

	it("rejects first orderBy referencing an ancestor alias outside the source scope", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "hasModule",
						expr: {
							type: "exists",
							source: descendantSource("module", "e", "courseModule", {
								operator: "gt",
								type: "comparison",
								right: literal(0),
								left: {
									type: "first",
									select: propertyRef("lesson", "lessons", ["position"]),
									orderBy: [{ order: "asc", expr: nameRef("e") }],
									source: descendantSource("lesson", "module", "moduleLesson", null),
								},
							}),
						},
					},
				],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/First orderBy cannot reference source alias 'e'/);
	});

	it("rejects first select referencing an ancestor alias outside the source scope", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "hasModule",
						expr: {
							type: "exists",
							source: descendantSource("module", "e", "courseModule", {
								operator: "gt",
								type: "comparison",
								right: literal(0),
								left: {
									type: "first",
									select: nameRef("e"),
									orderBy: [{ order: "asc", expr: propertyRef("lesson", "lessons", ["position"]) }],
									source: descendantSource("lesson", "module", "moduleLesson", null),
								},
							}),
						},
					},
				],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/First select cannot reference source alias 'e'/);
	});

	it("rejects first nested beyond the maximum expression source depth", () => {
		const doc = makeDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "asc", expr: nameRef("e") }],
				fields: [
					{
						key: "deepFirst",
						expr: {
							type: "exists",
							source: descendantSource("module", "e", "courseModule", {
								type: "exists",
								source: descendantSource("lesson", "module", "moduleLesson", {
									type: "exists",
									source: descendantSource("part", "lesson", "lessonPart", {
										type: "comparison",
										operator: "gt",
										right: literal(0),
										left: {
											type: "first",
											select: propertyRef("segment", "segments", ["index"]),
											orderBy: [
												{ order: "asc", expr: propertyRef("segment", "segments", ["index"]) },
											],
											source: descendantSource("segment", "part", "partSegment", null),
										},
									}),
								}),
							}),
						},
					},
				],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/Expression source depth exceeds maximum of 3/);
	});
});
