import { expect, it } from "@effect/vitest";
import {
	and,
	castDate,
	castNumber,
	column,
	contains,
	document,
	eq,
	field,
	join,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot/ryotql";

import { getCatalogTable } from "./catalog";
import { validateRyotQLDocument } from "./validator";

it("exposes only approved entity fields", () => {
	expect(new Set(Object.keys(getCatalogTable("entity")?.fields ?? {}))).toEqual(
		new Set([
			"id",
			"name",
			"userId",
			"createdAt",
			"updatedAt",
			"properties",
			"externalId",
			"providerId",
			"populatedAt",
			"translationStatus",
			"entitySchemaSlug",
		]),
	);
});

it("rejects unknown fields and tables", () => {
	const entity = table("entity", "entity");
	expect(
		validateRyotQLDocument(
			document({ entities: rows(entity, { fields: [field("secret", column(entity, "secret"))] }) }),
		),
	).toBe("Query 'entities': Unknown field 'secret' on table 'entity'");

	const auth = table("user", "user");
	expect(
		validateRyotQLDocument(
			document({ users: rows(auth, { fields: [field("id", column(auth, "id"))] }) }),
		),
	).toBe("Query 'users': Unknown table 'user'");
});

it("validates join aliases in lexical order", () => {
	const root = table("entity", "root");
	const child = table("entity", "child");
	const future = table("entity", "future");
	const query = rows(root, {
		fields: [],
		joins: [
			join("left", child, {
				operator: "eq",
				type: "comparison",
				left: column(root, "id"),
				right: column(future, "id"),
			}),
		],
	});

	expect(validateRyotQLDocument(document({ entities: query }))).toBe(
		"Query 'entities': Unknown table alias 'future'",
	);
});

it("accepts empty fields and rejects retained limits", () => {
	const entity = table("entity", "entity");
	expect(validateRyotQLDocument(document({ entities: rows(entity, { fields: [] }) }))).toBeNull();
	expect(
		validateRyotQLDocument(document({ entities: rows(entity, { limit: 101, fields: [] }) })),
	).toBe("Query 'entities': Rows limit must not exceed 100");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [],
					where: { type: "in", expr: column(entity, "id"), values: [] },
				}),
			}),
		),
	).toBeNull();
	expect(literal("unused")).toEqual({ type: "literal", value: "unused" });
});

it("rejects document and join counts above the retained limits", () => {
	const entity = table("entity", "entity");
	const query = rows(entity, { fields: [] });
	const queries = Object.fromEntries(
		Array.from({ length: 11 }, (_, index) => [`query${index}`, query]),
	);
	expect(validateRyotQLDocument(document(queries))).toBe(
		"A RyotQL document may contain at most 10 named queries",
	);

	const joins = Array.from({ length: 9 }, (_, index) => {
		const joined = table("entity", `joined${index}`);
		return join("inner", joined, {
			operator: "eq",
			type: "comparison",
			left: column(entity, "id"),
			right: column(joined, "id"),
		});
	});
	expect(validateRyotQLDocument(document({ entities: rows(entity, { fields: [], joins }) }))).toBe(
		"Query 'entities': A query may contain at most 8 joins",
	);
});

it("validates nested expression aliases, fields, JSON paths, and scalar kinds", () => {
	const entity = table("entity", "entity");
	const missing = table("entity", "missing");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [
						field("value", castNumber(jsonPath(column(missing, "properties"), "nested", "score"))),
					],
				}),
			}),
		),
	).toBe("Query 'entities': Unknown table alias 'missing'");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [field("value", jsonPath(column(entity, "name"), "nested"))],
				}),
			}),
		),
	).toBe("Query 'entities': JSON paths require a JSON expression");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [field("constant", literal(true))],
					where: and(
						eq(
							castDate(jsonPath(column(entity, "properties"), "date")),
							castDate(literal("2026-08-07")),
						),
						contains(column(entity, "name"), literal("RyotQL")),
					),
				}),
			}),
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [],
					where: eq(column(entity, "createdAt"), literal("2026-08-07T12:00:00.000Z")),
				}),
			}),
		),
	).toBe("Query 'entities': Comparison operands must have compatible types");
});
