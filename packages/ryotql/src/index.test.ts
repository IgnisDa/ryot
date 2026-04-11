import { describe, expect, it } from "vitest";

import {
	and,
	ascending,
	castBoolean,
	castDate,
	castJson,
	castNumber,
	castText,
	coalesce,
	column,
	contains,
	document,
	eq,
	field,
	gt,
	gte,
	isNotNull,
	isNull,
	include,
	join,
	jsonPath,
	literal,
	lt,
	lte,
	neq,
	not,
	or,
	rows,
	table,
} from "./index";

describe("RyotQL builders", () => {
	it("builds serializable named rows with defaults and omitted optional fields", () => {
		const entity = table("entity", "entity");

		expect(
			document({ entities: rows(entity, { fields: [field("id", column(entity, "id"))] }) }),
		).toEqual({
			queries: {
				entities: {
					from: { table: "entity", alias: "entity" },
					output: {
						type: "rows",
						pagination: { page: 1, limit: 20 },
						fields: [{ key: "id", expr: { type: "column", tableAlias: "entity", field: "id" } }],
						orderBy: [
							{ direction: "asc", expr: { type: "column", tableAlias: "entity", field: "id" } },
						],
					},
				},
			},
		});
	});

	it("preserves table aliases in expressions and explicit rows options", () => {
		const entity = table("entity", "collection");
		const query = rows(entity, {
			page: 2,
			limit: 7,
			orderBy: [ascending(column(entity, "name"))],
			fields: [field("name", column(entity, "name"))],
			where: eq(column(entity, "entitySchemaSlug"), literal("collection")),
		});

		expect(query).toMatchObject({
			output: { pagination: { page: 2, limit: 7 } },
			where: { left: { tableAlias: "collection" }, right: { value: "collection" } },
		});
	});

	it("builds JSON, cast, comparison, boolean, null, containment, and coalesce expressions", () => {
		const entity = table("entity", "entity");
		const nested = jsonPath(column(entity, "properties"), "details", 0, "score");
		const score = castNumber(nested);

		const query = rows(entity, {
			fields: [
				field("text", castText(nested)),
				field("date", castDate(nested)),
				field("json", castJson(nested)),
				field("score", score),
				field("boolean", castBoolean(nested)),
				field("fallback", coalesce(nested, literal("unknown"))),
			],
			where: and(
				eq(score, literal(1)),
				neq(score, literal(2)),
				gt(score, literal(0)),
				gte(score, literal(1)),
				lt(score, literal(2)),
				lte(score, literal(1)),
				contains(castText(nested), literal("_%")),
				isNotNull(nested),
				not(isNull(nested)),
				or(),
			),
		});

		expect(query.where).toMatchObject({ type: "and" });
		if (query.where?.type !== "and") {
			throw new Error("Expected conjunction");
		}
		expect(query.where.predicates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "comparison", operator: "gt" }),
				expect.objectContaining({ type: "contains" }),
				expect.objectContaining({ type: "not" }),
				{ type: "or", predicates: [] },
			]),
		);
		expect(query.output.fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "score",
					expr: expect.objectContaining({ type: "cast", target: "number" }),
				}),
				expect.objectContaining({
					key: "fallback",
					expr: expect.objectContaining({ type: "coalesce" }),
				}),
			]),
		);
	});

	it("rejects non-finite literal numbers", () => {
		expect(() => literal(Number.POSITIVE_INFINITY)).toThrow(
			"RyotQL literals require finite numbers",
		);
		expect(() => literal({ nested: [1, Number.NaN] })).toThrow(
			"RyotQL literals require finite numbers",
		);
	});

	it("builds joined correlated includes and omits absent options", () => {
		const course = table("entity", "course");
		const courseModule = table("relationship", "courseModule");
		const module = table("entity", "module");
		const modules = include(courseModule, {
			limit: 2,
			key: "modules",
			orderBy: [ascending(column(module, "name"))],
			fields: [field("name", column(module, "name"))],
			where: eq(column(courseModule, "sourceEntityId"), column(course, "id")),
			joins: [
				join("inner", module, eq(column(courseModule, "targetEntityId"), column(module, "id"))),
			],
		});

		expect(rows(course, { fields: [], include: [modules] })).toMatchObject({
			output: {
				include: [
					{
						limit: 2,
						key: "modules",
						from: { table: "relationship", alias: "courseModule" },
						joins: [{ type: "inner", table: { table: "entity", alias: "module" } }],
					},
				],
			},
		});
		expect(
			include(module, {
				limit: 1,
				fields: [],
				key: "empty",
				orderBy: [ascending(column(module, "id"))],
			}),
		).not.toHaveProperty("joins");
	});
});
