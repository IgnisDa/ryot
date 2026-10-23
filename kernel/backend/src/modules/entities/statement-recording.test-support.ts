import { PgClient } from "@effect/sql-pg";
import { DbError } from "@ryot-app/contract/errors";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";

const transactionStart = "<transaction>";
const transactionEnd = "</transaction>";

export class StatementLog extends Context.Service<
	StatementLog,
	{
		readonly errorCodes: Effect.Effect<ReadonlyArray<string>>;
		readonly lastTransaction: Effect.Effect<ReadonlyArray<string>>;
	}
>()("test/StatementLog") {}

export type StatementClass = "check" | "lock" | "lookup" | "receipt";

export const statementClass = (statement: string): StatementClass | null => {
	if (
		statement.includes("pg_advisory_xact_lock_shared") ||
		statement.includes('from "plugin_revision"') ||
		statement.includes('from "plugin_installation"') ||
		statement.includes('"disabled_at"')
	) {
		return "check";
	}
	if (statement.includes("pg_advisory_xact_lock(") || statement.includes(" for update")) {
		return "lock";
	}
	if (
		statement.includes('"mutation_receipt"') ||
		statement.includes('"user_lifecycle_operation"') ||
		statement.includes('from "user"')
	) {
		return "receipt";
	}
	return statement.startsWith("select") && statement.includes('from "entity"') ? "lookup" : null;
};

export const countStatementClasses = (statements: ReadonlyArray<string>) => {
	const counts: Record<StatementClass, number> = { lock: 0, check: 0, lookup: 0, receipt: 0 };
	for (const statement of statements) {
		const kind = statementClass(statement);
		if (kind) {
			counts[kind] += 1;
		}
	}
	return counts;
};

// Holding each matching lock for a while makes interleavings that can deadlock reproducible.
export const recordingDatabaseLayer = (options: { readonly holdLocks?: RegExp } = {}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const client = yield* PgClient.PgClient;
			const statements: string[] = [];
			const errorCodes: string[] = [];
			const unsafe = (statement: string, params?: ReadonlyArray<unknown>) => {
				statements.push(statement);
				return client.unsafe(
					options.holdLocks?.test(statement)
						? `select (select count(*) from (${statement}) locked), pg_sleep(0.2)`
						: statement,
					params,
				);
			};
			const recordingClient: PgClient.PgClient = Object.assign(Object.create(client), { unsafe });
			const session = yield* DatabaseSession.make.pipe(
				Effect.provideService(PgClient.PgClient, recordingClient),
			);
			const recordError = (error: unknown) =>
				Effect.sync(() => {
					if (error instanceof DbError && error.code) {
						errorCodes.push(error.code);
					}
				});
			const run: DatabaseSession["Service"]["run"] = (operation) =>
				session.run(operation).pipe(Effect.tapError(recordError));
			const transaction: DatabaseSession["Service"]["transaction"] = (work) =>
				Effect.sync(() => statements.push(transactionStart)).pipe(
					Effect.andThen(session.transaction(work)),
					Effect.tapError(recordError),
					Effect.ensuring(Effect.sync(() => statements.push(transactionEnd))),
				);
			return Layer.merge(
				Layer.succeed(DatabaseSession, { ...session, run, transaction }),
				Layer.succeed(StatementLog, {
					errorCodes: Effect.sync(() => [...errorCodes]),
					lastTransaction: Effect.sync(() => {
						const start = statements.lastIndexOf(transactionStart);
						const end = statements.indexOf(transactionEnd, start);
						return statements.slice(start + 1, end === -1 ? undefined : end);
					}),
				}),
			);
		}),
	);
