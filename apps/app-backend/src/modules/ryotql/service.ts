import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, DbError, dieOnDbError } from "@ryot/contract/errors";
import type { RyotQLDocument, RyotQLResult } from "@ryot/contract/modules/ryotql/language";
import { sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import {
	CurrentDb,
	TransactionRunner,
	dbEffect,
	setLocalStatementTimeout,
} from "#lib/infrastructure/db/service";

import { executeNamedQuery } from "./executor";
import { validateRyotQLDocument } from "./validator";

const RYOTQL_STATEMENT_TIMEOUT_MS = 30_000;

const configureTransaction = Effect.gen(function* () {
	const db = yield* CurrentDb;
	yield* dbEffect(() => db.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`));
});

export class RyotQLService extends Context.Service<RyotQLService>()("RyotQLService", {
	make: Effect.gen(function* () {
		const runInTx = yield* TransactionRunner;

		const executeForUser = Effect.fn("RyotQLService.executeForUser")(function* (
			userId: string,
			language: string | null,
			document: RyotQLDocument,
		) {
			const validationError = validateRyotQLDocument(document);
			if (validationError) {
				return yield* new BadRequest({ message: validationError });
			}

			return yield* runInTx(
				Effect.gen(function* () {
					yield* configureTransaction;
					yield* setLocalStatementTimeout(RYOTQL_STATEMENT_TIMEOUT_MS);
					const results: Array<readonly [string, RyotQLResult]> = [];
					for (const [name, query] of Object.entries(document.queries)) {
						results.push([name, yield* executeNamedQuery(userId, language, query)]);
					}
					return { data: Object.fromEntries(results) };
				}),
			).pipe(
				Effect.catchIf(
					(error): error is DbError => error instanceof DbError,
					(error) =>
						Effect.fail(
							error.code === "57014"
								? new BadRequest({
										message: `Query exceeded the maximum execution time of ${RYOTQL_STATEMENT_TIMEOUT_MS}ms`,
									})
								: error,
						),
				),
			);
		}, dieOnDbError);

		const execute = (user: CurrentUserValue, document: RyotQLDocument) =>
			executeForUser(user.id, user.preferences.language, document);

		return { execute, executeForUser };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
