import { assert, expect, it } from "@effect/vitest";
import { DbError } from "@ryot/contract/errors";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import {
	aggregate,
	and,
	ascending,
	castDate,
	castNumber,
	castText,
	coalesce,
	column,
	concat,
	contains,
	conditional,
	count,
	countDistinct,
	dateBucket,
	descending,
	divide,
	eq,
	exists,
	field,
	first,
	floor,
	groupDescending,
	gte,
	include,
	inArray,
	integer,
	isNotNull,
	join,
	jsonPath,
	kebabCase,
	literal,
	measure,
	measureDescending,
	not,
	rows,
	round,
	sum,
	table,
	timeSeries,
	titleCase,
} from "@ryot/ryotql";
import { allCollectionsRecipe } from "@ryot/ryotql-recipes/collections";
import { navigationRecipe } from "@ryot/ryotql-recipes/navigation";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer, Result, Schema } from "effect";

import { Database } from "#lib/infrastructure/db/service";

import { RyotQLService } from "./service";

const getCollectionsQuery = () => {
	const query = allCollectionsRecipe().document.queries["collections"];
	assert(query);
	return query;
};
const encodeCursor = (value: unknown) =>
	Buffer.from(Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(value)).toString(
		"base64url",
	);

const makeServiceLayer = (
	statements: string[],
	serviceRows: readonly Record<string, unknown>[] = [],
) => {
	const dialect = new PgDialect();
	const db = Object.assign(Object.create(null), {
		execute: (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
			const statement = dialect.sqlToQuery(query).sql;
			statements.push(statement);
			if (statement.startsWith("SET ") || statement.includes("set_config(")) {
				return Effect.succeed([]);
			}
			return Effect.succeed(serviceRows);
		},
	});
	return RyotQLService.layer.pipe(
		Layer.provide(
			Layer.succeed(
				Database,
				Database.of(
					Object.assign(Object.create(null), {
						transaction: ((callback) => callback(db)) satisfies Database["Service"]["transaction"],
					}),
				),
			),
		),
	);
};

it.effect("executes named queries sequentially in one configured transaction", () => {
	const statements: string[] = [];
	const collectionQuery = getCollectionsQuery();
	const doc = { queries: { first: collectionQuery, second: collectionQuery } };

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser("user-1", null, doc);

		expect(Object.keys(response.data)).toEqual(["first", "second"]);
		expect(statements[0]).toBe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
		expect(statements[1]).toContain("set_config('statement_timeout'");
		expect(statements.slice(2)).toHaveLength(2);
		expect(statements[2]).toMatch(/user_id = \$\d+ OR user_id IS NULL/);
		expect(statements[2]).not.toContain("COUNT(*)");
		expect(statements[2]).not.toContain("OFFSET");
		expect(statements[2]).toContain('t0.id COLLATE "C" ASC NULLS LAST');
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("returns an empty cursor page directly", () => {
	const statements: string[] = [];
	const recipe = allCollectionsRecipe({ limit: 1 });
	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser("user-1", null, recipe.document);

		expect(Result.getOrThrow(recipe.decode(response))).toEqual({
			items: [],
			pageInfo: { limit: 1, hasMore: false, nextCursor: null },
		});
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("returns a cursor from the last returned row and compiles mixed keyset orders", () => {
	const statements: string[] = [];
	const entity = table("entity", "entity");
	const query = rows(entity, {
		limit: 1,
		fields: [field("id", column(entity, "id"))],
		orderBy: [descending(column(entity, "createdAt")), ascending(column(entity, "name"))],
	});
	const resultRows = [
		{
			o0: new Date("2026-08-10T00:00:00.000Z"),
			o1: "duplicate",
			o2: "entity-1",
			f0v: "entity-1",
		},
		{
			o0: new Date("2026-08-09T00:00:00.000Z"),
			o1: null,
			o2: "entity-2",
			f0v: "entity-2",
		},
	];

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const firstExecution = yield* service.executeForUser("user-1", null, {
			queries: { entities: query },
		});
		const result = firstExecution.data["entities"];
		if (result?.type !== "rows" || result.pageInfo.nextCursor === null) {
			throw new Error("Expected rows cursor");
		}
		expect(result.items).toEqual([{ id: "entity-1" }]);
		expect(result.pageInfo).toEqual({ limit: 1, hasMore: true, nextCursor: expect.any(String) });

		yield* service.executeForUser("user-1", null, {
			queries: {
				entities: {
					...query,
					output: {
						...query.output,
						pagination: { limit: 1, after: result.pageInfo.nextCursor },
					},
				},
			},
		});

		const statement = statements[5];
		expect(statement).toContain(" < ");
		expect(statement).toContain(" > ");
		expect(statement).toContain("IS NOT DISTINCT FROM");
		expect(statement).toContain('COLLATE "C"');
		expect(statement).not.toContain("OFFSET");
	}).pipe(Effect.provide(makeServiceLayer(statements, resultRows)));
});

it.effect("rejects malformed cursor envelopes before row SQL", () => {
	const statements: string[] = [];
	const cases = [
		"not+base64url",
		encodeCursor({ version: 2, values: [] }),
		encodeCursor({ version: 1, values: [] }),
		encodeCursor({ version: 1, values: [{ kind: "number", value: 1 }] }),
		encodeCursor({ version: 1, values: [{ kind: "text", value: 1 }] }),
	];
	const entity = table("entity", "entity");

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		for (const after of cases) {
			const exit = yield* Effect.exit(
				service.executeForUser("user-1", null, {
					queries: {
						entities: rows(entity, {
							after,
							limit: 1,
							fields: [],
						}),
					},
				}),
			);
			expect(exit._tag).toBe("Failure");
		}
		expect(statements).toHaveLength(cases.length * 2);
		expect(
			statements.every(
				(statement) => statement.startsWith("SET ") || statement.includes("set_config("),
			),
		).toBe(true);
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("validates the complete document before opening a transaction", () => {
	const statements: string[] = [];
	const collectionQuery = getCollectionsQuery();
	const invalid = {
		queries: {
			valid: collectionQuery,
			invalid: { ...collectionQuery, from: { table: "auth", alias: "auth" } },
		},
	};
	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const error = yield* Effect.flip(service.executeForUser("user-1", null, invalid));

		expect(error).toMatchObject({ reason: { code: "invalid-query" } });
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
		expect(statement).not.toContain('COLLATE "C" IN');
		expect(statement?.match(/SELECT \* FROM entity WHERE/g)).toHaveLength(2);
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("applies public and user-only policies to navigation tables", () => {
	const statements: string[] = [];
	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		yield* service.executeForUser("user-1", null, navigationRecipe().document);

		const workspaces = statements[2];
		const savedViews = statements[3];
		expect(workspaces).toMatch(
			/FROM \(SELECT \* FROM plugin WHERE \(owner_id = \$\d+ OR owner_id IS NULL\)\)/,
		);
		expect(workspaces).toMatch(
			/LEFT JOIN \(SELECT \* FROM plugin_installation WHERE user_id = \$\d+\)/,
		);
		expect(workspaces).not.toContain("plugin_installation WHERE (user_id");
		expect(savedViews).toMatch(/FROM \(SELECT \* FROM saved_view WHERE user_id = \$\d+\)/);
		expect(savedViews).not.toContain("saved_view WHERE (user_id");
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect(
	"allows authenticated reads of sandbox provider metadata and reconstructs JSON null",
	() => {
		const statements: string[] = [];
		const provider = table("sandboxProvider", "provider");
		const operation = table("sandboxProviderOperation", "operation");
		const plugin = table("plugin", "plugin");
		const document = {
			queries: {
				providers: rows(provider, {
					fields: [
						field("id", column(provider, "id")),
						field("information", column(provider, "information")),
						field("optionsSchema", column(operation, "optionsSchema")),
					],
					joins: [
						join("inner", operation, eq(column(provider, "id"), column(operation, "providerId"))),
						join("inner", plugin, eq(column(provider, "pluginId"), column(plugin, "id"))),
					],
					where: and(
						eq(column(provider, "rootEntitySchemaSlug"), literal("item")),
						eq(column(operation, "operation"), literal("search")),
						eq(column(plugin, "status"), literal("active")),
					),
				}),
			},
		};
		const resultRows = [
			{
				f2v: null,
				f2k: "null",
				f1k: "json",
				f0k: "text",
				f0v: "provider-1",
				f1v: { source: "alpha" },
			},
		];

		return Effect.gen(function* () {
			const service = yield* RyotQLService;
			const response = yield* service.executeForUser("user-1", null, document);

			expect(statements[2]).toMatch(/FROM \(SELECT \* FROM sandbox_provider WHERE EXISTS \(/);
			expect(statements[2]).toMatch(
				/INNER JOIN \(SELECT \* FROM sandbox_provider_operation WHERE EXISTS \(/,
			);
			expect(statements[2]).toMatch(
				/INNER JOIN \(SELECT \* FROM plugin WHERE \(owner_id = \$\d+ OR owner_id IS NULL\)\)/,
			);
			expect(response.data["providers"]).toEqual({
				type: "rows",
				pageInfo: { limit: 20, hasMore: false, nextCursor: null },
				items: [
					{
						id: "provider-1",
						optionsSchema: null,
						information: { source: "alpha" },
					},
				],
			});
		}).pipe(Effect.provide(makeServiceLayer(statements, resultRows)));
	},
);

it.effect("rejects malformed runtime field kinds", () => {
	const statements: string[] = [];
	const entity = table("entity", "entity");
	const document = {
		queries: {
			entities: rows(entity, {
				fields: [field("score", jsonPath(column(entity, "properties"), "score"))],
			}),
		},
	};
	const resultRows = [{ f0k: "unexpected", f0v: 4 }];

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const exit = yield* Effect.exit(service.executeForUser("user-1", null, document));

		expect(exit._tag).toBe("Failure");
	}).pipe(Effect.provide(makeServiceLayer(statements, resultRows)));
});

it.effect("returns plain aggregate and time-series values", () => {
	const statements: string[] = [];
	const entity = table("entity", "entity");
	const document = {
		queries: {
			totals: aggregate(entity, {
				measures: [
					measure("count", { function: "count" }),
					measure("total", { expr: literal(2), function: "sum" }),
				],
			}),
			grouped: aggregate(entity, {
				limit: 10,
				measures: [
					measure("count", { function: "count" }),
					measure("total", { expr: literal(2), function: "sum" }),
				],
				orderBy: [groupDescending("day"), measureDescending("count")],
				groupBy: [
					field(
						"day",
						dateBucket(column(entity, "createdAt"), {
							bucket: "day",
							timeZone: "America/New_York",
						}),
					),
				],
			}),
			series: timeSeries(entity, {
				bucket: "day",
				measure: { function: "count" },
				endAt: "2026-08-03T00:00:00.000Z",
				startAt: "2026-08-01T00:00:00.000Z",
				time: column(entity, "createdAt"),
			}),
		},
	};
	const resultRows = [
		{
			m0: "3",
			m1: null,
			value: "2",
			g0k: "date",
			totalGroups: "1",
			g0v: new Date("2026-08-01T00:00:00.000Z"),
			endAt: new Date("2026-08-02T00:00:00.000Z"),
			startAt: new Date("2026-08-01T00:00:00.000Z"),
		},
	];

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser("user-1", null, document);
		const groupedStatement = statements.find((statement) => statement.includes('AS "g0v"'));

		expect(groupedStatement).toContain("date_trunc($1, t0.created_at, $2)");
		expect(groupedStatement).toContain('ORDER BY "g0v" DESC NULLS LAST, "m0" DESC NULLS LAST');
		expect(response.data["totals"]).toEqual({
			type: "aggregate",
			items: [{ count: 3, total: null }],
		});
		expect(response.data["grouped"]).toEqual({
			type: "aggregate",
			pageInfo: { hasMore: false, limit: 10 },
			items: [{ count: 3, day: "2026-08-01T00:00:00.000Z", total: null }],
		});
		expect(response.data["series"]).toEqual({
			type: "timeSeries",
			buckets: [
				{ value: 2, endAt: "2026-08-02T00:00:00.000Z", startAt: "2026-08-01T00:00:00.000Z" },
			],
		});
	}).pipe(Effect.provide(makeServiceLayer(statements, resultRows)));
});

it.effect("selects notification channel descriptions with text output", () => {
	const statements: string[] = [];
	const channel = table("notificationChannel", "channel");
	const document = {
		queries: {
			channels: rows(channel, { fields: [field("description", column(channel, "description"))] }),
		},
	};
	const resultRows = [{ f0k: "text", f0v: "Discord configured" }];

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser("user-1", null, document);

		expect(response.data["channels"]).toEqual({
			type: "rows",
			items: [{ description: "Discord configured" }],
			pageInfo: { limit: 20, hasMore: false, nextCursor: null },
		});
	}).pipe(Effect.provide(makeServiceLayer(statements, resultRows)));
});

it.effect("selects integrations with useful output kinds", () => {
	const statements: string[] = [];
	const integration = table("integration", "integration");
	const document = {
		queries: {
			integrations: rows(integration, {
				fields: [
					field("id", column(integration, "id")),
					field("lot", column(integration, "lot")),
					field("name", column(integration, "name")),
					field("provider", column(integration, "provider")),
					field("createdAt", column(integration, "createdAt")),
					field("updatedAt", column(integration, "updatedAt")),
					field("pluginSlug", column(integration, "pluginSlug")),
					field("isDisabled", column(integration, "isDisabled")),
					field("syncOwnership", column(integration, "syncOwnership")),
					field("extraSettings", column(integration, "extraSettings")),
					field("lastFinishedAt", column(integration, "lastFinishedAt")),
					field("minimumProgress", column(integration, "minimumProgress")),
					field("maximumProgress", column(integration, "maximumProgress")),
				],
			}),
		},
	};
	const resultRows = [
		{
			f0k: "text",
			f0v: "integration-1",
			f1k: "text",
			f1v: "example",
			f2k: "text",
			f2v: "Example integration",
			f3k: "text",
			f3v: "theta",
			f4k: "date",
			f4v: new Date("2026-08-01T10:00:00.000Z"),
			f5k: "date",
			f5v: new Date("2026-08-07T12:00:00.000Z"),
			f6k: "text",
			f6v: "example",
			f7k: "boolean",
			f7v: false,
			f8k: "boolean",
			f8v: true,
			f9k: "json",
			f9v: { disableOnContinuousErrors: true },
			f10k: "date",
			f10v: new Date("2026-08-07T10:00:00.000Z"),
			f11k: "number",
			f11v: "2",
			f12k: "number",
			f12v: "95",
		},
	];

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser("user-1", null, document);

		expect(response.data["integrations"]).toEqual({
			type: "rows",
			pageInfo: { limit: 20, hasMore: false, nextCursor: null },
			items: [
				{
					lot: "example",
					provider: "theta",
					pluginSlug: "example",
					id: "integration-1",
					isDisabled: false,
					minimumProgress: 2,
					maximumProgress: 95,
					syncOwnership: true,
					name: "Example integration",
					createdAt: "2026-08-01T10:00:00.000Z",
					updatedAt: "2026-08-07T12:00:00.000Z",
					lastFinishedAt: "2026-08-07T10:00:00.000Z",
					extraSettings: { disableOnContinuousErrors: true },
				},
			],
		});
	}).pipe(Effect.provide(makeServiceLayer(statements, resultRows)));
});

it.effect("selects notification subscription states with useful output kinds", () => {
	const statements: string[] = [];
	const state = table("notificationSubscriptionState", "state");
	const document = {
		queries: {
			states: rows(state, {
				fields: [
					field("id", column(state, "id")),
					field("signalSchemaSlug", column(state, "signalSchemaSlug")),
					field("isActive", column(state, "isActive")),
					field("createdAt", column(state, "createdAt")),
					field("updatedAt", column(state, "updatedAt")),
				],
			}),
		},
	};
	const resultRows = [
		{
			f2v: true,
			f0k: "text",
			f1k: "text",
			f3k: "date",
			f4k: "date",
			f0v: "rule-1",
			f2k: "boolean",
			f1v: "review.created",
			f3v: new Date("2026-08-01T10:00:00.000Z"),
			f4v: new Date("2026-08-07T12:00:00.000Z"),
		},
	];

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser("user-1", null, document);

		expect(response.data["states"]).toEqual({
			type: "rows",
			pageInfo: { limit: 20, hasMore: false, nextCursor: null },
			items: [
				{
					id: "rule-1",
					isActive: true,
					signalSchemaSlug: "review.created",
					createdAt: "2026-08-01T10:00:00.000Z",
					updatedAt: "2026-08-07T12:00:00.000Z",
				},
			],
		});
	}).pipe(Effect.provide(makeServiceLayer(statements, resultRows)));
});

it.effect("authorizes notification channels in every query occurrence", () => {
	const statements: string[] = [];
	const root = table("notificationChannel", "root");
	const joined = table("notificationChannel", "joined");
	const included = table("notificationChannel", "included");
	const correlated = table("notificationChannel", "correlated");
	const document = {
		queries: {
			channels: rows(root, {
				fields: [],
				joins: [join("left", joined, eq(column(root, "id"), column(joined, "id")))],
				where: exists(correlated, {
					where: eq(column(correlated, "id"), column(root, "id")),
				}),
				include: [
					include(included, {
						limit: 1,
						key: "related",
						fields: [field("id", column(included, "id"))],
						orderBy: [ascending(column(included, "createdAt"))],
						where: eq(column(included, "id"), column(root, "id")),
					}),
				],
			}),
		},
	};

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		yield* service.executeForUser("user-1", null, document);

		const statement = statements[2];
		expect(statement?.match(/SELECT \* FROM notification_channel WHERE user_id =/g)).toHaveLength(
			4,
		);
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("authorizes integrations in every query occurrence", () => {
	const statements: string[] = [];
	const root = table("integration", "root");
	const joined = table("integration", "joined");
	const included = table("integration", "included");
	const correlated = table("integration", "correlated");
	const document = {
		queries: {
			integrations: rows(root, {
				fields: [],
				joins: [join("left", joined, eq(column(root, "id"), column(joined, "id")))],
				where: exists(correlated, {
					where: eq(column(correlated, "id"), column(root, "id")),
				}),
				include: [
					include(included, {
						limit: 1,
						key: "related",
						fields: [field("id", column(included, "id"))],
						orderBy: [ascending(column(included, "createdAt"))],
						where: eq(column(included, "id"), column(root, "id")),
					}),
				],
			}),
		},
	};

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		yield* service.executeForUser("user-1", null, document);

		const statement = statements[2];
		expect(statement?.match(/SELECT \* FROM integration WHERE user_id =/g)).toHaveLength(4);
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("authorizes notification subscription states in every query occurrence", () => {
	const statements: string[] = [];
	const root = table("notificationSubscriptionState", "root");
	const joined = table("notificationSubscriptionState", "joined");
	const included = table("notificationSubscriptionState", "included");
	const correlated = table("notificationSubscriptionState", "correlated");
	const document = {
		queries: {
			states: rows(root, {
				fields: [],
				joins: [join("left", joined, eq(column(root, "id"), column(joined, "id")))],
				where: exists(correlated, {
					where: eq(column(correlated, "id"), column(root, "id")),
				}),
				include: [
					include(included, {
						limit: 1,
						key: "related",
						fields: [field("id", column(included, "id"))],
						orderBy: [ascending(column(included, "createdAt"))],
						where: eq(column(included, "id"), column(root, "id")),
					}),
				],
			}),
		},
	};

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		yield* service.executeForUser("user-1", null, document);

		const statement = statements[2];
		expect(
			statement?.match(/SELECT \* FROM notification_subscription_state WHERE user_id =/g),
		).toHaveLength(4);
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("constrains own and cross-user import run roots to the current user", () => {
	const statements: string[] = [];
	const own = table("importRun", "own");
	const crossUser = table("importRun", "crossUser");
	const document = {
		queries: {
			own: rows(own, {
				fields: [field("id", column(own, "id"))],
				where: eq(column(own, "id"), literal("own-run")),
			}),
			crossUser: rows(crossUser, {
				fields: [field("id", column(crossUser, "id"))],
				where: eq(column(crossUser, "id"), literal("cross-user-run")),
			}),
		},
	};

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser("user-1", null, document);

		for (const statement of statements.slice(2)) {
			expect(statement).toMatch(/FROM \(SELECT \* FROM import_run WHERE user_id = \$\d+\)/);
		}
		const empty = {
			items: [],
			type: "rows",
			pageInfo: { limit: 20, hasMore: false, nextCursor: null },
		};
		expect(response.data["own"]).toEqual(empty);
		expect(response.data["crossUser"]).toEqual(empty);
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("authorizes import runs and failures in every query occurrence", () => {
	const statements: string[] = [];
	const run = table("importRun", "run");
	const root = table("importRunFailure", "root");
	const left = table("importRunFailure", "left");
	const inner = table("importRunFailure", "inner");
	const included = table("importRunFailure", "included");
	const correlated = table("importRunFailure", "correlated");
	const document = {
		queries: {
			failures: rows(root, {
				fields: [field("id", column(root, "id"))],
				where: exists(correlated, {
					where: eq(column(correlated, "runId"), column(root, "runId")),
				}),
				joins: [
					join("inner", inner, eq(column(root, "runId"), column(inner, "runId"))),
					join("left", left, eq(column(root, "runId"), column(left, "runId"))),
					join("inner", run, eq(column(root, "runId"), column(run, "id"))),
				],
				include: [
					include(included, {
						limit: 1,
						key: "related",
						fields: [field("id", column(included, "id"))],
						orderBy: [ascending(column(included, "createdAt"))],
						where: eq(column(included, "runId"), column(root, "runId")),
					}),
				],
			}),
		},
	};

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser("user-1", null, document);

		const statement = statements[2];
		expect(statement).toContain("INNER JOIN (SELECT * FROM import_run_failure WHERE EXISTS");
		expect(statement).toContain("LEFT JOIN (SELECT * FROM import_run_failure WHERE EXISTS");
		expect(statement).toMatch(/SELECT \* FROM import_run WHERE user_id = \$\d+/);
		expect(statement?.match(/SELECT \* FROM import_run_failure WHERE EXISTS/g)).toHaveLength(5);
		expect(statement).toMatch(
			/import_run\.id = import_run_failure\.run_id AND import_run\.user_id = \$\d+/,
		);
		expect(response.data["failures"]).toEqual({
			items: [],
			type: "rows",
			pageInfo: { limit: 20, hasMore: false, nextCursor: null },
		});
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("applies plugin ownership to every allowed table occurrence", () => {
	const statements: string[] = [];
	const entity = table("entity", "entity");
	const event = table("event", "event");
	const correlatedEvent = table("event", "correlatedEvent");
	const relationship = table("relationship", "relationship");
	const includedRelationship = table("relationship", "includedRelationship");
	const document = {
		queries: {
			entities: rows(entity, {
				joins: [join("left", event, eq(column(event, "entityId"), column(entity, "id")))],
				fields: [
					field("eventId", column(event, "id")),
					field(
						"isMonitored",
						exists(relationship, {
							where: eq(column(relationship, "sourceEntityId"), column(entity, "id")),
						}),
					),
					field(
						"hasEvent",
						exists(correlatedEvent, {
							where: eq(column(correlatedEvent, "entityId"), column(entity, "id")),
						}),
					),
				],
				include: [
					include(includedRelationship, {
						limit: 1,
						key: "relationships",
						orderBy: [ascending(column(includedRelationship, "id"))],
						fields: [field("id", column(includedRelationship, "id"))],
						where: eq(column(includedRelationship, "sourceEntityId"), column(entity, "id")),
					}),
				],
			}),
		},
	};

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		yield* service.executeForPlugin(
			{
				pluginSlug: "example",
				entitySchemaSlugs: ["item"],
				relationshipSchemaSlugs: ["example-monitoring"],
				eventSchemas: [{ eventSchemaSlug: "review", entitySchemaSlug: "item" }],
			},
			document,
		);

		const statement = statements[2];
		expect(statement).toContain(
			"FROM (SELECT * FROM entity WHERE user_id IS NULL AND entity_schema_slug IN",
		);
		expect(statement).toContain(
			"FROM (SELECT * FROM relationship WHERE relationship_schema_slug IN",
		);
		expect(statement).toContain("LEFT JOIN (\n\t\t\tSELECT * FROM event");
		expect(statement).toContain("event.event_schema_slug =");
		expect(statement).toContain("event_scope_entity.entity_schema_slug =");
		expect(statement).toContain("FROM (SELECT * FROM relationship WHERE");
		expect(statement).not.toContain("relationship WHERE (user_id");
		expect(statement).not.toContain("event WHERE (user_id");
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("denies application tables to plugin execution before opening a transaction", () => {
	const statements: string[] = [];
	const plugin = table("plugin", "plugin");
	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const error = yield* Effect.flip(
			service.executeForPlugin(
				{
					eventSchemas: [],
					pluginSlug: "example",
					entitySchemaSlugs: [],
					relationshipSchemaSlugs: [],
				},
				{ queries: { plugins: rows(plugin, { fields: [] }) } },
			),
		);

		expect(error).toMatchObject({ reason: { code: "invalid-query" } });
		expect(statements).toEqual([]);
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
			f0v: createdAt,
			f1v: { rating: 5 },
		},
	];
	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser("user-1", null, document);
		const result = response.data["__proto__"];
		if (result?.type !== "rows") {
			throw new Error("Expected reserved query result");
		}
		const item = result.items[0];
		if (!item) {
			throw new Error("Expected reserved field result");
		}

		expect(Object.hasOwn(response.data, "__proto__")).toBe(true);
		expect(Object.hasOwn(item, "__proto__")).toBe(true);
		expect(item["__proto__"]).toBe(createdAt.toISOString());
		expect(item["properties"]).toEqual({ rating: 5 });
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
		expect(statements.slice(2)).toHaveLength(1);
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("compiles scalar text, conditional, and unary operations", () => {
	const statements: string[] = [];
	const entity = table("entity", "entity");
	const document = {
		queries: {
			entities: rows(entity, {
				fields: [
					field("concat", concat(column(entity, "name"), literal(" suffix"))),
					field(
						"conditional",
						conditional(eq(literal(true), literal(true)), literal("yes"), literal("no")),
					),
					field("title", titleCase(column(entity, "name"))),
					field("kebab", kebabCase(column(entity, "name"))),
					field("round", round(literal(1.5))),
					field("floor", floor(literal(1.5))),
					field("integer", integer(literal(-1.5))),
					field("notNull", isNotNull(column(entity, "name"))),
				],
			}),
		},
	};

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		yield* service.executeForUser("user-1", null, document);

		const statement = statements[2];
		expect(statement).toContain("concat(");
		expect(statement).toContain("CASE WHEN");
		expect(statement).toContain("initcap(");
		expect(statement).toContain("btrim(lower(");
		expect(statement).toContain("round(");
		expect(statement).toContain("floor(");
		expect(statement).toContain("trunc(");
		expect(statement).toContain(" IS NOT NULL");
		expect(statement?.match(/regexp_replace\(/g)?.length).toBeGreaterThanOrEqual(4);
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

it.effect("compiles and reconstructs nested correlated includes in one statement", () => {
	const statements: string[] = [];
	const course = table("entity", "course");
	const module = table("entity", "module");
	const completion = table("event", "completion");
	const courseModule = table("relationship", "courseModule");
	const completions = include(completion, {
		limit: 1,
		key: "completions",
		orderBy: [{ direction: "desc", expr: column(completion, "occurredAt") }],
		fields: [field("occurredAt", column(completion, "occurredAt"))],
		where: eq(column(completion, "entityId"), column(module, "id")),
	});
	const modules = include(courseModule, {
		limit: 1,
		key: "modules",
		include: [completions],
		orderBy: [{ direction: "asc", expr: column(module, "name") }],
		where: eq(column(courseModule, "sourceEntityId"), column(course, "id")),
		joins: [
			join("inner", module, eq(column(courseModule, "targetEntityId"), column(module, "id"))),
		],
		fields: [
			field("name", column(module, "name")),
			field("active", literal(true)),
			field("metadata", literal({ position: 1 })),
			field("optional", literal(null)),
		],
	});
	const document = {
		queries: {
			courses: rows(course, {
				include: [modules],
				fields: [field("name", column(course, "name"))],
			}),
		},
	};
	const resultRows = [
		{
			f0k: "text",
			f0v: "Course",
			i0: {
				hasMore: true,
				items: [
					[
						"Module",
						true,
						{ position: 1 },
						null,
						{ hasMore: false, items: [["2026-08-07T12:00:00+00:00"]] },
					],
				],
			},
		},
	];

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser("user-1", null, document);

		expect(statements.slice(2)).toHaveLength(1);
		expect(statements[2]?.match(/SELECT \* FROM relationship WHERE/g)).toHaveLength(1);
		expect(statements[2]?.match(/SELECT \* FROM event WHERE/g)).toHaveLength(1);
		expect(statements[2]).toContain("ROW_NUMBER() OVER");
		expect(statements[2]).toContain("jsonb_build_object");
		const courses = response.data["courses"];
		if (courses?.type !== "rows") {
			throw new Error("Expected courses rows result");
		}
		expect(courses.items).toEqual([
			{
				name: "Course",
				modules: {
					pageInfo: { limit: 1, hasMore: true },
					items: [
						{
							name: "Module",
							optional: null,
							active: true,
							metadata: { position: 1 },
							completions: {
								pageInfo: { limit: 1, hasMore: false },
								items: [{ occurredAt: "2026-08-07T12:00:00.000Z" }],
							},
						},
					],
				},
			},
		]);
	}).pipe(Effect.provide(makeServiceLayer(statements, resultRows)));
});

it.effect("compiles correlated scalar expressions with authorized query sets", () => {
	const statements: string[] = [];
	const entity = table("entity", "entity");
	const event = table("event", "event");
	const related = { where: eq(column(event, "entityId"), column(entity, "id")) };
	const eventCount = count(event, related);
	const document = {
		queries: {
			entities: rows(entity, {
				fields: [
					field("hasEvents", exists(event, related)),
					field(
						"latest",
						first(event, {
							...related,
							select: column(event, "occurredAt"),
							orderBy: [ascending(column(event, "occurredAt"))],
						}),
					),
					field("count", eventCount),
					field("distinct", countDistinct(event, column(event, "entityId"), related)),
					field("sum", sum(event, literal(2), related)),
					field("ratio", divide(eventCount, literal(0))),
					field(
						"fallback",
						coalesce(
							first(event, {
								...related,
								select: column(event, "id"),
								orderBy: [ascending(column(event, "id"))],
							}),
							literal("none"),
						),
					),
				],
			}),
		},
	};
	const resultRows = [
		{
			f0v: true,
			f0k: "boolean",
			f1v: null,
			f1k: "null",
			f2v: 0,
			f2k: "number",
			f3v: 0,
			f3k: "number",
			f4v: null,
			f4k: "null",
			f5v: null,
			f5k: "null",
			f6v: "none",
			f6k: "text",
		},
	];

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser("user-1", null, document);

		const statement = statements[2];
		expect(statement).toContain("EXISTS (SELECT 1");
		expect(statement).toContain("COUNT(DISTINCT");
		expect(statement).toContain("SUM(");
		expect(statement).toContain("NULLIF");
		expect(statement?.match(/SELECT \* FROM event WHERE/g)?.length).toBeGreaterThan(0);
		const entities = response.data["entities"];
		if (entities?.type !== "rows") {
			throw new Error("Expected entities rows result");
		}
		expect(entities.items[0]).toEqual({
			sum: null,
			count: 0,
			ratio: null,
			latest: null,
			distinct: 0,
			fallback: "none",
			hasEvents: true,
		});
	}).pipe(Effect.provide(makeServiceLayer(statements, resultRows)));
});

it.effect("maps statement timeouts to a bad request", () => {
	const statements: string[] = [];
	const dialect = new PgDialect();
	const db = Object.assign(Object.create(null), {
		execute: (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
			const statement = dialect.sqlToQuery(query).sql;
			statements.push(statement);
			return !statement.startsWith("SET ") && !statement.includes("set_config(")
				? Effect.fail(new DbError({ code: "57014", message: "statement timeout" }))
				: Effect.succeed([]);
		},
	});
	const layer = RyotQLService.layer.pipe(
		Layer.provide(
			Layer.succeed(
				Database,
				Database.of(
					Object.assign(Object.create(null), {
						transaction: ((callback) => callback(db)) satisfies Database["Service"]["transaction"],
					}),
				),
			),
		),
	);

	return Effect.gen(function* () {
		const service = yield* RyotQLService;
		const error = yield* Effect.flip(
			service.executeForUser("user-1", null, allCollectionsRecipe().document),
		);

		expect(error).toMatchObject({ reason: { code: "query-timeout", limitMs: 30_000 } });
	}).pipe(Effect.provide(layer));
});
