import { describe, expect, it } from "vitest";

import type { Expr, QueryDocument } from "./language";
import { validateQueryDocument } from "./validator";
import { literal, makeDoc, nameRef, occurredAtRef, propertyRef } from "./validator.test-support";

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
		expect(validateQueryDocument(doc)).toMatch(/First expressions are currently valid only/);
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
		expect(validateQueryDocument(doc)).toMatch(/First expressions are currently valid only/);
	});
});
