import { runWithAdapter } from "@better-auth/core/context";
import type {
	CleanedWhere,
	CustomAdapter,
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
import { Effect, Exit } from "effect";

import * as authSchema from "#lib/infrastructure/db/schema/tables/auth";
import { mapDatabaseErrors, type Database } from "#lib/infrastructure/db/service";
import type { RedisService } from "#lib/infrastructure/redis";

type AuthRow = Record<string, unknown>;
type AuthTable = PgTable;
type DatabaseExecutor =
	| Database["Service"]
	| Parameters<Parameters<Database["Service"]["transaction"]>[0]>[0];
type AuthAdapterFactory = ReturnType<typeof createAdapterFactory>;

const tables: Record<string, AuthTable> = {
	user: authSchema.user,
	apikey: authSchema.apikey,
	account: authSchema.account,
	session: authSchema.session,
	twoFactor: authSchema.twoFactor,
	verification: authSchema.verification,
};

const getTable = (model: string) => {
	const table = tables[model];
	if (!table) {
		throw new BetterAuthError(`Auth model "${model}" is not present in the Drizzle schema.`);
	}
	return table;
};

const getColumn = (table: AuthTable, model: string, field: string) => {
	const column = getColumns(table)[field];
	if (!column) {
		throw new BetterAuthError(`Auth field "${field}" is not present on model "${model}".`);
	}
	return column;
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

export const effectPostgresAuthAdapter = (args: {
	readonly db: Database["Service"];
	readonly context: Context.Context<Database | RedisService>;
}) => {
	const root = args.db;
	const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseWith(args.context)(effect);

	const createCustomAdapter =
		(db: DatabaseExecutor) =>
		({ getFieldName }: Parameters<Parameters<typeof createAdapterFactory>[0]["adapter"]>[0]) => {
			const addJoins = (rows: readonly AuthRow[], join: JoinConfig | undefined) =>
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
							result[joinModel] = config.relation === "one-to-one" ? (joined[0] ?? null) : joined;
						}
						return result;
					}),
				);

			const adapter: CustomAdapter = {
				create: ({ model, data }) =>
					run(db.insert(getTable(model)).values(data).returning()).then((rows) =>
						Object.assign(data, rows[0]),
					),
				findOne: ({ model, where, select, join }) =>
					// Better Auth supplies the result type from its model registry, which is not exposed to custom adapters.
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion
					run(
						Effect.gen(function* () {
							const table = getTable(model);
							const selection = makeSelection(model, select, getFieldName) ?? getColumns(table);
							const rows = yield* db
								.select(selection)
								.from(table)
								.where(makeWhere(model, where, getFieldName))
								.limit(1);
							if (!rows[0]) {
								return null;
							}
							return join ? (yield* addJoins(rows, join))[0] : rows[0];
						}),
					) as Promise<never>,
				findMany: ({ model, where, limit, select, sortBy, offset, join }) =>
					// Better Auth supplies the result type from its model registry, which is not exposed to custom adapters.
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion
					run(
						Effect.gen(function* () {
							const table = getTable(model);
							const selection = makeSelection(model, select, getFieldName) ?? getColumns(table);
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
							return join ? yield* addJoins(rows, join) : rows;
						}),
					) as Promise<never>,
				count: ({ model, where }) =>
					run(
						db
							.select({ value: count() })
							.from(getTable(model))
							.where(makeWhere(model, where, getFieldName)),
					).then((rows) => rows[0]?.value ?? 0),
				update: ({ model, where, update }) => {
					if (!where.length) {
						// Better Auth's generic update result is not recoverable when no row is selected.
						// oxlint-disable-next-line typescript/no-unsafe-type-assertion
						return Promise.resolve(null) as Promise<never>;
					}
					const table = getTable(model);
					const id = getColumn(table, model, getFieldName({ model, field: "id" }));
					const target = db
						.select({ id })
						.from(table)
						.where(makeWhere(model, where, getFieldName))
						.limit(1);
					// Better Auth supplies the result type from its model registry, which is not exposed to custom adapters.
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion
					return run(
						db
							.update(table)
							// Better Auth guarantees update is a model-shaped object, but leaves its generic unconstrained.
							// oxlint-disable-next-line typescript/no-unsafe-type-assertion
							.set(update as {})
							.where(inArray(id, target))
							.returning(),
					).then((rows) => rows[0] ?? null) as Promise<never>;
				},
				updateMany: ({ model, where, update }) =>
					run(
						db
							.update(getTable(model))
							// Better Auth guarantees update is a model-shaped object, but Drizzle sees a dynamic table.
							// oxlint-disable-next-line typescript/no-unsafe-type-assertion
							.set(update as {})
							.where(makeWhere(model, where, getFieldName))
							.returning(),
					).then((rows) => rows.length),
				delete: ({ model, where }) =>
					run(db.delete(getTable(model)).where(makeWhere(model, where, getFieldName))).then(
						() => undefined,
					),
				deleteMany: ({ model, where }) =>
					run(
						db
							.delete(getTable(model))
							.where(makeWhere(model, where, getFieldName))
							.returning(),
					).then((rows) => rows.length),
				consumeOne: ({ model, where }) => {
					const table = getTable(model);
					const id = getColumn(table, model, getFieldName({ model, field: "id" }));
					const target = db
						.select({ id })
						.from(table)
						.where(makeWhere(model, where, getFieldName))
						.limit(1);
					// Better Auth supplies the result type from its model registry, which is not exposed to custom adapters.
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion
					return run(db.delete(table).where(inArray(id, target)).returning()).then(
						(rows) => rows[0] ?? null,
					) as Promise<never>;
				},
				incrementOne: ({ model, where, increment, set }) => {
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
					// Better Auth supplies the result type from its model registry, which is not exposed to custom adapters.
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion
					return run(
						db
							.update(table)
							.set(update)
							.where(and(guard, inArray(id, target)))
							.returning(),
					).then((rows) => rows[0] ?? null) as Promise<never>;
				},
			};
			return adapter;
		};

	let options: Parameters<ReturnType<typeof createAdapterFactory>>[0];
	const makeFactory = (db: DatabaseExecutor, transaction: boolean): AuthAdapterFactory =>
		createAdapterFactory({
			adapter: createCustomAdapter(db),
			config: {
				adapterId: "ryot-effect-postgres",
				adapterName: "Ryot Effect PostgreSQL Adapter",
				supportsArrays: true,
				supportsJSON: true,
				supportsUUIDs: true,
				transaction: transaction
					? <A>(callback: (adapter: DBTransactionAdapter) => Promise<A>) =>
							run(
								root.transaction((tx) =>
									Effect.tryPromise(() => callback(makeFactory(tx, false)(options))),
								),
							)
					: false,
			},
		});

	const factory = makeFactory(root, true);
	const database = (authOptions: typeof options) => {
		options = authOptions;
		return factory(authOptions);
	};
	const transaction = <A, E>(
		callback: (adapter: DBTransactionAdapter, db: DatabaseExecutor) => Effect.Effect<A, E>,
	) =>
		mapDatabaseErrors(
			root.transaction((tx) =>
				Effect.callback<A, E>((resume) => {
					const adapter = makeFactory(tx, false)(options);
					void Promise.resolve(
						runWithAdapter(adapter, () =>
							Effect.runPromiseExitWith(args.context)(callback(adapter, tx)),
						),
					).then((exit) =>
						resume(
							Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.failCause(exit.cause),
						),
					);
				}),
			),
		);

	return Object.assign(database, { transaction });
};
