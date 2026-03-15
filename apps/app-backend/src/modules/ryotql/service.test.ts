import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot/contract/errors";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import {
	and,
	castDate,
	castNumber,
	castText,
	coalesce,
	column,
	contains,
	eq,
	field,
	gte,
	inArray,
	join,
	jsonPath,
	literal,
	not,
	rows,
	table,
} from "@ryot/ryotql";
import { buildAllCollectionsDocument } from "@ryot/ryotql-recipes/collections";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { CurrentDb, TransactionRunner } from "#lib/infrastructure/db/service";

import { RyotQLService } from "./service";

const requireCollectionsQuery = () => {
	const query = buildAllCollectionsDocument().queries["collections"];
	if (!query) {
		throw new Error("Expected collections query");
	}
	return query;
};

const makeServiceLayer = (
	statements: string[],
	serviceRows: readonly Record<string, unknown>[] = [],
) => {
	const dialect = new PgDialect();
	const db = Object.assign(Object.create(null), {
		execute: (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
			const statement = dialect.sqlToQuery(query).sql;
			statements.push(statement);
			if (!statement.includes('WITH "queryRows"')) {
				return Promise.resolve({ rows: [] });
			}
			return Promise.resolve({
				rows: serviceRows.length > 0 ? serviceRows : [{ totalCount: 0, rowPresent: null }],
			});
		},
	});
	const provideDb = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.provideService(effect, CurrentDb, db);
	return RyotQLService.layer.pipe(Layer.provide(Layer.succeed(TransactionRunner, provideDb)));
};

it.effect("executes named queries sequentially in one configured transaction", () => {
	const statements: string[] = [];
	const collectionQuery = requireCollectionsQuery();
	const doc = { queries: { first: collectionQuery, second: collectionQuery } };

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser("user-1", null, doc);

		expect(Object.keys(response.data)).toEqual(["first", "second"]);
		expect(statements[0]).toBe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
		expect(statements[1]).toContain("set_config('statement_timeout'");
		expect(statements.filter((statement) => statement.includes('WITH "queryRows"'))).toHaveLength(
			2,
		);
		expect(statements[2]).toMatch(/user_id = \$\d+ OR user_id IS NULL/);
		expect(statements[2]).toContain('COUNT(*)::integer AS "totalCount"');
		expect(statements[2]).toContain('"o1" COLLATE "C" ASC NULLS LAST');
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("returns the real total for an empty page", () => {
	const statements: string[] = [];
	const testRows = [{ totalCount: 3, rowPresent: null }];
	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser(
			"user-1",
			null,
			buildAllCollectionsDocument({ page: 4, limit: 1 }),
		);

		expect(response.data["collections"]).toEqual({
			items: [],
			type: "rows",
			pageInfo: { page: 4, limit: 1, total: 3, hasMore: false },
		});
	}).pipe(Effect.provide(makeServiceLayer(statements, testRows)));
});

it.effect("validates the complete document before opening a transaction", () => {
	const statements: string[] = [];
	const collectionQuery = requireCollectionsQuery();
	const invalid = {
		queries: {
			valid: collectionQuery,
			invalid: { ...collectionQuery, from: { table: "auth", alias: "auth" } },
		},
	};
	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const error = yield* Effect.flip(service.executeForUser("user-1", null, invalid));

		expect(error.message).toBe("Query 'invalid': Unknown table 'auth'");
		expect(statements).toEqual([]);
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("collates text predicates and authorizes every joined table occurrence", () => {
	const statements: string[] = [];
	const root = table("entity", "root");
	const child = table("entity", "child");
	const document = {
		queries: {
			entities: rows(root, {
				fields: [],
				where: inArray(column(root, "name"), [literal("First"), literal("Second")]),
				joins: [join("left", child, eq(column(root, "id"), column(child, "id")))],
			}),
		},
	};

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		yield* service.executeForUser("user-1", null, document);

		const statement = statements[2];
		expect(statement).toContain("LEFT JOIN (SELECT * FROM entity");
		expect(statement).toContain('COLLATE "C" IN');
		expect(statement?.match(/SELECT \* FROM entity WHERE/g)).toHaveLength(2);
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("preserves reserved result keys and non-text runtime kinds", () => {
	const statements: string[] = [];
	const entity = table("entity", "entity");
	const query = rows(entity, {
		fields: [
			field("__proto__", column(entity, "createdAt")),
			field("properties", column(entity, "properties")),
		],
	});
	const document: RyotQLDocument = { queries: Object.fromEntries([["__proto__", query]]) };
	const createdAt = new Date("2026-08-07T12:00:00.000Z");
	const resultRows = [
		{
			f1k: "json",
			f0k: "date",
			totalCount: 1,
			f0v: createdAt,
			rowPresent: true,
			f1v: { rating: 5 },
		},
	];
	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser("user-1", null, document);
		const result = response.data["__proto__"];
		if (!result) {
			throw new Error("Expected reserved query result");
		}
		const item = result.items[0];
		if (!item) {
			throw new Error("Expected reserved field result");
		}

		expect(Object.hasOwn(response.data, "__proto__")).toBe(true);
		expect(Object.hasOwn(item, "__proto__")).toBe(true);
		expect(item["__proto__"]).toEqual({ kind: "date", value: createdAt.toISOString() });
		expect(item["properties"]).toEqual({ kind: "json", value: { rating: 5 } });
	}).pipe(Effect.provide(makeServiceLayer(statements, resultRows)));
});

it.effect("pushes typed JSON expressions into one rows statement", () => {
	const statements: string[] = [];
	const entity = table("entity", "entity");
	const scorePath = jsonPath(column(entity, "properties"), "details", "score");
	const tagsPath = jsonPath(column(entity, "properties"), "tags");
	const publishedPath = jsonPath(column(entity, "properties"), "publishedAt");
	const document = {
		queries: {
			entities: rows(entity, {
				fields: [
					field("score", castNumber(scorePath)),
					field("publishedAt", castDate(publishedPath)),
					field(
						"fallback",
						coalesce(jsonPath(column(entity, "properties"), "author"), literal("Unknown")),
					),
				],
				where: and(
					gte(castNumber(scorePath), literal(4)),
					contains(castText(jsonPath(column(entity, "properties"), "label")), literal("%_")),
					contains(tagsPath, literal(["featured"])),
					not(eq(castNumber(scorePath), literal(null))),
				),
			}),
		},
	};

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		yield* service.executeForUser("user-1", null, document);

		const statement = statements[2];
		expect(statement).toContain("jsonb_extract_path");
		expect(statement).toContain("pg_input_is_valid");
		expect(statement).toContain(" ILIKE ");
		expect(statement).toContain(" @> ");
		expect(statements.filter((value) => value.includes('WITH "queryRows"'))).toHaveLength(1);
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("resolves localized fields and emits translation-status SQL only when referenced", () => {
	const statements: string[] = [];
	const entity = table("entity", "entity");
	const localizedDocument = {
		queries: {
			entities: rows(entity, {
				where: contains(column(entity, "name"), literal("localized")),
				fields: [
					field("name", column(entity, "name")),
					field("properties", column(entity, "properties")),
				],
			}),
		},
	};
	const statusDocument = {
		queries: {
			entities: rows(entity, {
				fields: [field("translationStatus", column(entity, "translationStatus"))],
			}),
		},
	};

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		yield* service.executeForUser("user-1", "es", localizedDocument);
		yield* service.executeForUser("user-1", "es", statusDocument);

		const localizedStatement = statements[2];
		const statusStatement = statements[5];
		expect(localizedStatement).toContain("entity_translation");
		expect(localizedStatement).not.toContain("sandbox_provider");
		expect(statusStatement).toContain("entity_translation");
		expect(statusStatement).toContain("sandbox_provider");
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("maps statement timeouts to a bad request", () => {
	const statements: string[] = [];
	const dialect = new PgDialect();
	const db = Object.assign(Object.create(null), {
		execute: (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
			const statement = dialect.sqlToQuery(query).sql;
			statements.push(statement);
			return statement.includes('WITH "queryRows"')
				? Promise.reject(new DbError({ code: "57014", message: "statement timeout" }))
				: Promise.resolve({ rows: [] });
		},
	});
	const provideDb = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.provideService(effect, CurrentDb, db);
	const layer = RyotQLService.layer.pipe(
		Layer.provide(Layer.succeed(TransactionRunner, provideDb)),
	);

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const error = yield* Effect.flip(
			service.executeForUser("user-1", null, buildAllCollectionsDocument()),
		);

		expect(error.message).toBe("Query exceeded the maximum execution time of 30000ms");
	}).pipe(Effect.provide(layer));
});
