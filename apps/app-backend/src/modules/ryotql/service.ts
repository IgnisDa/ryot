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

import type { RyotQLExecutionScope } from "./catalog";
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

		const executeWithScope = Effect.fn("RyotQLService.executeWithScope")(function* (
			scope: RyotQLExecutionScope,
			document: RyotQLDocument,
		) {
			const validationError = validateRyotQLDocument(document, scope);
			if (validationError) {
				return yield* new BadRequest({ message: validationError });
			}

			return yield* runInTx(
				Effect.gen(function* () {
					yield* configureTransaction;
					yield* setLocalStatementTimeout(RYOTQL_STATEMENT_TIMEOUT_MS);
					const results: Array<readonly [string, RyotQLResult]> = [];
					for (const [name, query] of Object.entries(document.queries)) {
						results.push([name, yield* executeNamedQuery(scope, query)]);
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

		const executeForUser = (userId: string, language: string | null, document: RyotQLDocument) =>
			executeWithScope({ type: "user", userId, language }, document);

		const executeForPlugin = (
			scope: Omit<Extract<RyotQLExecutionScope, { type: "plugin" }>, "type">,
			document: RyotQLDocument,
		) => executeWithScope({ ...scope, type: "plugin" }, document);

		const validate = Effect.fn("RyotQLService.validate")(function* (document: RyotQLDocument) {
			const validationError = validateRyotQLDocument(document, { type: "user" });
			if (validationError) {
				return yield* new BadRequest({ message: validationError });
			}
		});

		const execute = (user: CurrentUserValue, document: RyotQLDocument) =>
			executeForUser(user.id, user.preferences.language, document);

		return { execute, executeForUser, executeForPlugin, validate };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
