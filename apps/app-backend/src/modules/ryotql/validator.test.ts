import { expect, it } from "@effect/vitest";
import { column, document, field, join, literal, rows, table } from "@ryot/ryotql";

import { getCatalogTable } from "./catalog";
import { validateRyotQLDocument } from "./validator";

it("exposes only approved entity fields", () => {
	expect(Object.keys(getCatalogTable("entity")?.fields ?? {})).toEqual([
		"id",
		"name",
		"userId",
		"createdAt",
		"updatedAt",
		"properties",
		"externalId",
		"populatedAt",
		"providerId",
		"entitySchemaSlug",
	]);
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

it("rejects expressions outside the initial rows subset", () => {
	const entity = table("entity", "entity");
	expect(
		validateRyotQLDocument(
			document({ entities: rows(entity, { fields: [field("constant", literal(true))] }) }),
		),
	).toBe("Query 'entities': Literal field projections are not supported yet");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [],
					where: {
						operator: "eq",
						type: "comparison",
						left: column(entity, "createdAt"),
						right: literal("2026-08-07T12:00:00.000Z"),
					},
				}),
			}),
		),
	).toBe("Query 'entities': Comparison operands must have compatible types");
});
