import { expect, it } from "@effect/vitest";
import {
	aggregate,
	and,
	ascending,
	castDate,
	castNumber,
	column,
	contains,
	count,
	document,
	eq,
	exists,
	field,
	first,
	include,
	join,
	jsonPath,
	literal,
	measure,
	measureDescending,
	rows,
	sum,
	table,
	timeSeries,
} from "@ryot/ryotql";

import { getCatalogTable } from "./catalog";
import { validateRyotQLDocument } from "./validator";

const nested = (depth: number): ReturnType<typeof include> => {
	const child = table("entity", `child${depth}`);
	return include(child, {
		limit: 10,
		fields: [],
		key: `child${depth}`,
		...(depth < 4 ? { include: [nested(depth + 1)] } : {}),
		orderBy: [{ direction: "asc", expr: column(child, "id") }],
	});
};

const nestedExists = (depth: number, maximum: number): ReturnType<typeof exists> => {
	const child = table("entity", `correlated${depth}`);
	return exists(child, {
		where: depth < maximum ? nestedExists(depth + 1, maximum) : undefined,
	});
};

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

it("exposes only approved event fields", () => {
	expect(new Set(Object.keys(getCatalogTable("event")?.fields ?? {}))).toEqual(
		new Set([
			"id",
			"userId",
			"entityId",
			"createdAt",
			"updatedAt",
			"properties",
			"occurredAt",
			"eventSchemaSlug",
			"sessionEntityId",
		]),
	);
});

it("exposes only approved relationship fields", () => {
	expect(new Set(Object.keys(getCatalogTable("relationship")?.fields ?? {}))).toEqual(
		new Set([
			"id",
			"userId",
			"createdAt",
			"properties",
			"sourceEntityId",
			"targetEntityId",
			"relationshipSchemaSlug",
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

it("validates aggregate keys, grouped requirements, ordering, and limits", () => {
	const entity = table("entity", "entity");
	const countMeasure = measure("count", { function: "count" });
	const group = field("name", column(entity, "name"));

	expect(
		validateRyotQLDocument(document({ entities: aggregate(entity, { measures: [countMeasure] }) })),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({
				entities: aggregate(entity, {
					groupBy: [group],
					measures: [countMeasure],
					orderBy: [measureDescending("count")],
				}),
			}),
		),
	).toBe("Query 'entities': Grouped aggregate outputs require a limit");
	expect(
		validateRyotQLDocument(
			document({
				entities: aggregate(entity, { limit: 10, groupBy: [group], measures: [countMeasure] }),
			}),
		),
	).toBe("Query 'entities': Grouped aggregate outputs require non-empty orderBy");
	expect(
		validateRyotQLDocument(
			document({
				entities: aggregate(entity, {
					limit: 1001,
					groupBy: [group],
					measures: [countMeasure],
					orderBy: [measureDescending("count")],
				}),
			}),
		),
	).toBe("Query 'entities': Grouped aggregate limit must not exceed 1000");
	expect(
		validateRyotQLDocument(
			document({
				entities: aggregate(entity, {
					limit: 10,
					groupBy: [group],
					measures: [countMeasure],
					orderBy: [measureDescending("missing")],
				}),
			}),
		),
	).toBe("Query 'entities': Unknown aggregate measure key 'missing'");
	expect(
		validateRyotQLDocument(
			document({
				entities: aggregate(entity, {
					limit: 10,
					measures: [countMeasure],
					orderBy: [measureDescending("count")],
					groupBy: [field("count", column(entity, "name"))],
				}),
			}),
		),
	).toBe("Query 'entities': Duplicate aggregate output key 'count'");
});

it("validates time-series ranges, expressions, measures, and bucket limits", () => {
	const entity = table("entity", "entity");
	const input = {
		bucket: "day" as const,
		endAt: "2026-01-03T00:00:00.000Z",
		startAt: "2026-01-01T00:00:00.000Z",
		measure: { function: "count" } as const,
		time: column(entity, "createdAt"),
	};

	expect(validateRyotQLDocument(document({ entities: timeSeries(entity, input) }))).toBeNull();
	expect(
		validateRyotQLDocument(
			document({
				entities: timeSeries(entity, {
					...input,
					time: castDate(jsonPath(column(entity, "properties"), "publishedAt")),
					measure: {
						function: "sum",
						expr: castNumber(jsonPath(column(entity, "properties"), "duration")),
					},
				}),
			}),
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({ entities: timeSeries(entity, { ...input, time: column(entity, "name") }) }),
		),
	).toBe(
		"Query 'entities': Time-series time expressions require a date field or explicit date cast",
	);
	expect(
		validateRyotQLDocument(
			document({
				entities: timeSeries(entity, { ...input, endAt: "2026-01-01T00:00:00.000Z" }),
			}),
		),
	).toBe("Query 'entities': Time-series range startAt must be before endAt");
	expect(
		validateRyotQLDocument(
			document({ entities: timeSeries(entity, { ...input, endAt: "not-a-date" }) }),
		),
	).toBe("Query 'entities': Time-series range startAt and endAt must be valid dates");
	expect(
		validateRyotQLDocument(
			document({
				entities: timeSeries(entity, { ...input, endAt: "2028-10-01T00:00:00.000Z" }),
			}),
		),
	).toBe("Query 'entities': Time-series bucket count exceeds maximum of 1000");
	expect(
		validateRyotQLDocument(
			document({
				entities: timeSeries(entity, {
					...input,
					endAt: "2022-09-27T00:00:00.000500Z",
					startAt: "2020-01-01T01:00:00.000+01:00",
				}),
			}),
		),
	).toBeNull();
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

it("validates include correlation, lexical scopes, keys, limits, and depth", () => {
	const course = table("entity", "course");
	const relationship = table("relationship", "courseModule");
	const module = table("entity", "module");
	const modules = include(relationship, {
		limit: 10,
		key: "modules",
		fields: [field("name", column(module, "name"))],
		orderBy: [{ direction: "asc", expr: column(module, "name") }],
		where: eq(column(relationship, "sourceEntityId"), column(course, "id")),
		joins: [
			join("inner", module, eq(column(relationship, "targetEntityId"), column(module, "id"))),
		],
	});
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, { fields: [field("id", column(course, "id"))], include: [modules] }),
			}),
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					include: [modules],
					fields: [field("modules", column(course, "id"))],
				}),
			}),
		),
	).toBe("Query 'courses': Duplicate output key 'modules'");

	const unknown = table("entity", "siblingAlias");
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					fields: [],
					include: [
						modules,
						include(module, {
							limit: 10,
							fields: [],
							key: "lessons",
							orderBy: [{ direction: "asc", expr: column(module, "id") }],
							where: eq(column(module, "id"), column(unknown, "id")),
						}),
					],
				}),
			}),
		),
	).toBe("Query 'courses': Include 'lessons': Unknown table alias 'siblingAlias'");

	const shadowed = table("entity", "course");
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					fields: [],
					include: [
						include(shadowed, {
							limit: 10,
							fields: [],
							key: "shadowed",
							orderBy: [{ direction: "asc", expr: column(shadowed, "id") }],
						}),
					],
				}),
			}),
		),
	).toBe("Query 'courses': Include 'shadowed': Duplicate table alias 'course'");

	const joinedRoot = table("entity", "joinedRoot");
	const tooManyJoins = Array.from({ length: 9 }, (_, index) => {
		const joined = table("entity", `includeJoin${index}`);
		return join("inner", joined, eq(column(joinedRoot, "id"), column(joined, "id")));
	});
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					fields: [],
					include: [
						include(joinedRoot, {
							limit: 10,
							fields: [],
							key: "joined",
							joins: tooManyJoins,
							orderBy: [{ direction: "asc", expr: column(joinedRoot, "id") }],
						}),
					],
				}),
			}),
		),
	).toBe("Query 'courses': Include 'joined': A query may contain at most 8 joins");

	const limited = table("entity", "limited");
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					fields: [],
					include: [
						include(limited, {
							limit: 101,
							fields: [],
							key: "limited",
							orderBy: [{ direction: "asc", expr: column(limited, "id") }],
						}),
					],
				}),
			}),
		),
	).toBe("Query 'courses': Include limit must not exceed 100");
	expect(
		validateRyotQLDocument(
			document({ courses: rows(course, { fields: [], include: [nested(1)] }) }),
		),
	).toBe(
		"Query 'courses': Include 'child1': Include 'child2': Include 'child3': Include depth must not exceed 3",
	);
});

it("validates correlated expression scopes and ordering", () => {
	const course = table("entity", "course");
	const event = table("event", "event");
	const relationship = table("relationship", "relationship");
	const related = {
		where: eq(column(event, "entityId"), column(course, "id")),
	};
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					where: exists(event, related),
					fields: [
						field("count", count(event, related)),
						field("total", sum(event, jsonPath(column(event, "properties"), "score"), related)),
						field(
							"first",
							first(event, {
								...related,
								select: column(event, "occurredAt"),
								orderBy: [ascending(column(event, "occurredAt"))],
							}),
						),
					],
				}),
			}),
		),
	).toBeNull();

	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					fields: [field("duplicate", count(table("event", "course")))],
				}),
			}),
		),
	).toBe("Query 'courses': Duplicate table alias 'course'");

	const future = table("event", "future");
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					fields: [
						field(
							"forward",
							count(event, {
								joins: [
									join("inner", relationship, eq(column(relationship, "id"), column(future, "id"))),
									join("inner", future, eq(column(event, "id"), column(future, "id"))),
								],
							}),
						),
					],
				}),
			}),
		),
	).toBe("Query 'courses': Unknown table alias 'future'");

	const sibling = table("event", "sibling");
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					fields: [
						field(
							"unknown",
							count(event, { where: eq(column(event, "id"), column(sibling, "id")) }),
						),
					],
				}),
			}),
		),
	).toBe("Query 'courses': Unknown table alias 'sibling'");
});

it("enforces the correlated expression depth limit", () => {
	const root = table("entity", "root");

	expect(
		validateRyotQLDocument(
			document({ root: rows(root, { fields: [], where: nestedExists(1, 3) }) }),
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({ root: rows(root, { fields: [], where: nestedExists(1, 4) }) }),
		),
	).toBe("Query 'root': Correlated query depth must not exceed 3");
});
