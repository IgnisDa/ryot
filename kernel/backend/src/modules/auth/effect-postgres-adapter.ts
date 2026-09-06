import type { GenericEndpointContext } from "@better-auth/core";
import { getCurrentAdapter } from "@better-auth/core/context";
import type {
	CleanedWhere,
	CustomAdapter,
	DBAdapter,
	DBTransactionAdapter,
	JoinConfig,
} from "@better-auth/core/db/adapter";
import { createAdapterFactory } from "@better-auth/core/db/adapter";
import { BetterAuthError } from "@better-auth/core/error";
import {
	and,
	asc,
	count,
	desc,
	eq,
	getColumns,
	gt,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	ne,
	notInArray,
	or,
	sql,
	type SQL,
} from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Context } from "effect";
import { Effect } from "effect";

import * as authSchema from "#lib/infrastructure/db/schema/tables/auth";
import type { DatabaseSession } from "#lib/infrastructure/db/session";
import type { RedisService } from "#lib/infrastructure/redis";

type AuthRow = Record<string, unknown>;
type AuthTable = PgTable;
type DatabaseExecutor = Parameters<Parameters<DatabaseSession["Service"]["run"]>[0]>[0];
type AuthAdapterFactory = ReturnType<typeof createAdapterFactory>;
type AuthRuntimeContext = Context.Context<DatabaseSession | RedisService>;

const tables: Record<string, AuthTable> = {
	user: authSchema.user,
	jwks: authSchema.jwks,
	apikey: authSchema.apikey,
	account: authSchema.account,
	session: authSchema.session,
	twoFactor: authSchema.twoFactor,
	oauthClient: authSchema.oauthClient,
	oauthConsent: authSchema.oauthConsent,
	verification: authSchema.verification,
	oauthResource: authSchema.oauthResource,
	oauthAccessToken: authSchema.oauthAccessToken,
	oauthRefreshToken: authSchema.oauthRefreshToken,
	oauthClientResource: authSchema.oauthClientResource,
	oauthClientAssertion: authSchema.oauthClientAssertion,
};

const getTable = (model: string) => {
	const table = tables[model];
	if (!table) {
		throw new BetterAuthError(`Auth model "${model}" is not present in the Drizzle schema.`);
	}
	return table;
};

const getColumn = (table: AuthTable, model: string, field: string) => {
	if (model === "user" && field === "preferences") {
		throw new BetterAuthError("User preferences belong to the application, not authentication.");
	}
	const column = getColumns(table)[field];
	if (!column) {
		throw new BetterAuthError(`Auth field "${field}" is not present on model "${model}".`);
	}
	return column;
};

const authSelection = (model: string, table: AuthTable) =>
	Object.fromEntries(
		Object.entries(getColumns(table)).filter(
			([name]) => model !== "user" || name !== "preferences",
		),
	);

const authRow = (model: string, row: AuthRow) => {
	if (model !== "user") {
		return row;
	}
	const { preferences: _preferences, ...authUser } = row;
	return authUser;
};

const insensitiveValue = (value: unknown) =>
	typeof value === "string" ? value.toLowerCase() : value;

const makePredicate = (column: AnyPgColumn, where: CleanedWhere): SQL => {
	const insensitive = where.mode === "insensitive";
	const value = where.value;

	if (where.operator === "in" || where.operator === "not_in") {
		if (!Array.isArray(value)) {
			throw new BetterAuthError(`The value for "${where.field}" must be an array.`);
		}
		const values = insensitive ? value.map(insensitiveValue) : value;
		const target = insensitive ? sql`lower(${column})` : sql`${column}`;
		return where.operator === "in" ? inArray(target, values) : notInArray(target, values);
	}
	if (where.operator === "contains") {
		return insensitive ? ilike(column, `%${String(value)}%`) : like(column, `%${String(value)}%`);
	}
	if (where.operator === "starts_with") {
		return insensitive ? ilike(column, `${String(value)}%`) : like(column, `${String(value)}%`);
	}
	if (where.operator === "ends_with") {
		return insensitive ? ilike(column, `%${String(value)}`) : like(column, `%${String(value)}`);
	}
	if (where.operator === "lt") {
		return lt(column, value);
	}
	if (where.operator === "lte") {
		return lte(column, value);
	}
	if (where.operator === "gt") {
		return gt(column, value);
	}
	if (where.operator === "gte") {
		return gte(column, value);
	}
	if (where.operator === "ne") {
		if (value === null) {
			return isNotNull(column);
		}
		return insensitive
			? sql`lower(${column}) <> ${String(value).toLowerCase()}`
			: ne(column, value);
	}
	if (value === null) {
		return isNull(column);
	}
	return insensitive ? sql`lower(${column}) = ${String(value).toLowerCase()}` : eq(column, value);
};

const makeWhere = (
	model: string,
	where: CleanedWhere[] | undefined,
	getFieldName: (input: { model: string; field: string }) => string,
) => {
	if (!where?.length) {
		return undefined;
	}
	const table = getTable(model);
	const predicates = where.map((entry) =>
		makePredicate(getColumn(table, model, getFieldName({ model, field: entry.field })), entry),
	);
	const andPredicates = predicates.filter((_, index) => where[index]?.connector !== "OR");
	const orPredicates = predicates.filter((_, index) => where[index]?.connector === "OR");
	if (andPredicates.length && orPredicates.length) {
		return and(and(...andPredicates), or(...orPredicates));
	}
	return andPredicates.length ? and(...andPredicates) : or(...orPredicates);
};

const makeSelection = (
	model: string,
	select: string[] | undefined,
	getFieldName: (input: { model: string; field: string }) => string,
) => {
	if (!select?.length) {
		return undefined;
	}
	const table = getTable(model);
	return Object.fromEntries(
		select.map((field) => {
			const name = getFieldName({ model, field });
			return [name, getColumn(table, model, name)];
		}),
	);
};

const run = <A, E, R>(context: Context.Context<R>, effect: Effect.Effect<A, E, R>) =>
	Effect.runPromiseWith(context)(effect);

const addJoins = (db: DatabaseExecutor, rows: readonly AuthRow[], join: JoinConfig | undefined) =>
	Effect.forEach(rows, (row) =>
		Effect.gen(function* () {
			const result = { ...row };
			for (const [joinModel, config] of Object.entries(join ?? {})) {
				const table = getTable(joinModel);
				const joined = yield* db
					.select()
					.from(table)
					.where(eq(getColumn(table, joinModel, config.on.to), row[config.on.from]))
					.limit(config.relation === "one-to-one" ? 1 : (config.limit ?? 100));
				if (config.relation === "one-to-one") {
					result[joinModel] = joined[0] ? authRow(joinModel, joined[0]) : null;
				} else {
					result[joinModel] = joined.map((item) => authRow(joinModel, item));
				}
			}
			return result;
		}),
	);

export const effectPostgresAuthAdapter = (args: {
	readonly session: DatabaseSession["Service"];
	readonly context: AuthRuntimeContext;
}) => {
	const session = args.session;
	const contexts = new WeakMap<DBTransactionAdapter | DBAdapter, AuthRuntimeContext>();
	let rootAdapter: DBAdapter | undefined;

	const createCustomAdapter = (context: AuthRuntimeContext) => {
		const runOperation = <A, E>(operation: (db: DatabaseExecutor) => Effect.Effect<A, E>) =>
			run(context, session.run(operation));

		return ({
			getFieldName,
		}: Parameters<Parameters<typeof createAdapterFactory>[0]["adapter"]>[0]) => {
			const adapter: CustomAdapter = {
				delete: ({ model, where }) =>
					runOperation((db) =>
						Effect.asVoid(db.delete(getTable(model)).where(makeWhere(model, where, getFieldName))),
					),
				deleteMany: ({ model, where }) =>
					runOperation((db) =>
						Effect.map(
							db
								.delete(getTable(model))
								.where(makeWhere(model, where, getFieldName))
								.returning(),
							(rows) => rows.length,
						),
					),
				count: ({ model, where }) =>
					runOperation((db) =>
						Effect.map(
							db
								.select({ value: count() })
								.from(getTable(model))
								.where(makeWhere(model, where, getFieldName)),
							(rows) => rows[0]?.value ?? 0,
						),
					),
				updateMany: ({ model, where, update }) =>
					runOperation((db) =>
						Effect.map(
							db
								.update(getTable(model))
								.set(update)
								.where(makeWhere(model, where, getFieldName))
								.returning(),
							(rows) => rows.length,
						),
					),
				create: ({ data, model }) =>
					runOperation((db) =>
						Effect.map(db.insert(getTable(model)).values(data).returning(), (rows) => {
							const created = Object.assign(data, rows[0]);
							if (model === "user") {
								Reflect.deleteProperty(created, "preferences");
							}
							return created;
						}),
					),
				consumeOne: ({ model, where }) => {
					const deleted = runOperation((db) => {
						const table = getTable(model);
						const id = getColumn(table, model, getFieldName({ model, field: "id" }));
						const target = db
							.select({ id })
							.from(table)
							.where(makeWhere(model, where, getFieldName))
							.limit(1);
						return Effect.map(
							db.delete(table).where(inArray(id, target)).returning(),
							(rows) => rows[0] ?? null,
						);
					});
					// Better Auth supplies the result type from its model registry, which is not exposed to custom adapters.
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion
					return deleted as Promise<never>;
				},
				findOne: ({ join, model, where, select }) => {
					const found = runOperation((db) =>
						Effect.gen(function* () {
							const table = getTable(model);
							const selection =
								makeSelection(model, select, getFieldName) ?? authSelection(model, table);
							const rows = yield* db
								.select(selection)
								.from(table)
								.where(makeWhere(model, where, getFieldName))
								.limit(1);
							if (!rows[0]) {
								return null;
							}
							return authRow(model, (join ? (yield* addJoins(db, rows, join))[0] : rows[0]) ?? {});
						}),
					);
					// Better Auth supplies the result type from its model registry, which is not exposed to custom adapters.
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion
					return found as Promise<never>;
				},
				update: ({ model, where, update }) => {
					if (!where.length) {
						return Promise.resolve(null);
					}
					const updated = runOperation((db) => {
						const table = getTable(model);
						const id = getColumn(table, model, getFieldName({ model, field: "id" }));
						const target = db
							.select({ id })
							.from(table)
							.where(makeWhere(model, where, getFieldName))
							.limit(1);
						return Effect.map(
							db
								.update(table)
								// Better Auth guarantees update is a model-shaped object, but leaves its generic unconstrained.
								// oxlint-disable-next-line typescript/no-unsafe-type-assertion
								.set(update as {})
								.where(inArray(id, target))
								.returning(),
							(rows) => (rows[0] ? authRow(model, rows[0]) : null),
						);
					});
					// Better Auth supplies the result type from its model registry, which is not exposed to custom adapters.
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion
					return updated as Promise<never>;
				},
				incrementOne: ({ set, model, where, increment }) => {
					const incremented = runOperation((db) => {
						const table = getTable(model);
						const id = getColumn(table, model, getFieldName({ model, field: "id" }));
						const guard = makeWhere(model, where, getFieldName);
						const target = db.select({ id }).from(table).where(guard).limit(1);
						const update: Record<string, unknown> = { ...set };
						for (const [field, delta] of Object.entries(increment)) {
							const name = getFieldName({ model, field });
							const column = getColumn(table, model, name);
							update[name] = sql`${column} + ${delta}`;
						}
						return Effect.map(
							db
								.update(table)
								.set(update)
								.where(and(guard, inArray(id, target)))
								.returning(),
							(rows) => rows[0] ?? null,
						);
					});
					// Better Auth supplies the result type from its model registry, which is not exposed to custom adapters.
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion
					return incremented as Promise<never>;
				},
				findMany: ({ join, model, where, limit, select, sortBy, offset }) => {
					const found = runOperation((db) =>
						Effect.gen(function* () {
							const table = getTable(model);
							const selection =
								makeSelection(model, select, getFieldName) ?? authSelection(model, table);
							let query = db
								.select(selection)
								.from(table)
								.where(makeWhere(model, where, getFieldName))
								.limit(limit)
								.offset(offset ?? 0)
								.$dynamic();
							if (sortBy) {
								const column = getColumn(
									table,
									model,
									getFieldName({ model, field: sortBy.field }),
								);
								query = query.orderBy(sortBy.direction === "desc" ? desc(column) : asc(column));
							}
							const rows = yield* query;
							return (join ? yield* addJoins(db, rows, join) : rows).map((row) =>
								authRow(model, row),
							);
						}),
					);
					// Better Auth supplies the result type from its model registry, which is not exposed to custom adapters.
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion
					return found as Promise<never>;
				},
			};
			return adapter;
		};
	};

	let options: Parameters<ReturnType<typeof createAdapterFactory>>[0];
	const makeFactory = (context: AuthRuntimeContext, transaction: boolean): AuthAdapterFactory =>
		createAdapterFactory({
			adapter: createCustomAdapter(context),
			config: {
				supportsJSON: true,
				supportsUUIDs: true,
				supportsArrays: true,
				adapterId: "ryot-effect-postgres",
				adapterName: "Ryot Effect PostgreSQL Adapter",
				transaction: transaction
					? <A>(callback: (adapter: DBTransactionAdapter) => Promise<A>) =>
							run(
								context,
								session.transaction(
									Effect.gen(function* () {
										const transactionContext = yield* Effect.context<
											DatabaseSession | RedisService
										>();
										const adapter = makeFactory(transactionContext, false)(options);
										contexts.set(adapter, transactionContext);
										return yield* Effect.tryPromise(() => callback(adapter));
									}),
								),
							)
					: false,
			},
		});

	const factory = makeFactory(args.context, true);
	const adapter = (authOptions: typeof options) => {
		options = authOptions;
		rootAdapter = factory(authOptions);
		contexts.set(rootAdapter, args.context);
		return rootAdapter;
	};
	// oxlint-disable-next-line effecttsgo/async-function -- Better Auth requires a Promise-returning context bridge.
	const runInCurrentContext = async <A, E>(
		endpointContext: GenericEndpointContext | null,
		effect: Effect.Effect<A, E, DatabaseSession | RedisService>,
	) => {
		if (!rootAdapter) {
			throw new BetterAuthError("The auth adapter has not been initialized.");
		}
		const current = await getCurrentAdapter(endpointContext?.context.adapter ?? rootAdapter);
		const context = contexts.get(current);
		if (!context) {
			throw new BetterAuthError("The current auth adapter has no Effect transaction context.");
		}
		return run(context, effect);
	};
	return { adapter, runInCurrentContext };
};
