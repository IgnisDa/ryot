import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { DbError } from "@ryot-app/contract/errors";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot-app/contract/modules/ryotql/contract";
import type { RyotQLDocument, RyotQLResult } from "@ryot-app/contract/modules/ryotql/language";
import type { AccessClass } from "@ryot-app/contract/oauth";
import { sql } from "drizzle-orm";
import { Context, Effect, Layer, Match } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";

import type { RyotQLAudience, RyotQLExecutionScope } from "./catalog";
import { executeNamedQuery } from "./executor";
import { normalizeRyotQLDocument } from "./normalizer";
import { validateRyotQLDocument } from "./validator";

const RYOTQL_STATEMENT_TIMEOUT_MS = 30_000;

export class RyotQLService extends Context.Service<RyotQLService>()("RyotQLService", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;

		const executeWithScope = Effect.fn("RyotQLService.executeWithScope")(function* (
			scope: RyotQLExecutionScope,
			document: RyotQLDocument,
			resultBytes?: number,
		) {
			const validationError = validateRyotQLDocument(document, scope);
			if (validationError) {
				yield* Effect.logWarning("RyotQL validation failed", { diagnostic: validationError });
				return yield* new RyotQLBadRequest({ reason: { code: "invalid-query" } });
			}
			const normalizedDocument = normalizeRyotQLDocument(document, scope);

			return yield* session
				.transaction(
					session.run((transaction) =>
						Effect.gen(function* () {
							yield* transaction.execute(
								sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
							);
							yield* transaction.execute(
								sql`SELECT set_config('statement_timeout', ${RYOTQL_STATEMENT_TIMEOUT_MS.toString()}, true)`,
							);
							const budget =
								resultBytes === undefined
									? undefined
									: { limitBytes: resultBytes, remainingBytes: resultBytes };
							const results: Array<readonly [string, RyotQLResult]> = [];
							for (const [name, query] of Object.entries(normalizedDocument.queries)) {
								results.push([
									name,
									yield* executeNamedQuery(scope, query, name, transaction, budget),
								]);
							}
							return { data: Object.fromEntries(results) };
						}),
					),
				)
				.pipe(
					Effect.catchTag(
						"DatabaseSessionStateError",
						() => new RyotQLInternalError({ reason: { code: "execution-failed" } }),
					),
					Effect.catchIf(
						(error): error is DbError => error instanceof DbError,
						(error) =>
							Effect.logError("RyotQL database execution failed", error).pipe(
								Effect.andThen(
									Match.value(error.code).pipe(
										Match.when("57014", () =>
											Effect.fail(
												new RyotQLBadRequest({
													reason: { code: "query-timeout", limitMs: RYOTQL_STATEMENT_TIMEOUT_MS },
												}),
											),
										),
										Match.orElse(() =>
											Effect.fail(
												new RyotQLInternalError({ reason: { code: "execution-failed" } }),
											),
										),
									),
								),
							),
					),
				);
		});

		const executeForUser = (
			userId: string,
			language: string | null,
			audience: RyotQLAudience,
			document: RyotQLDocument,
			accessClass: AccessClass = "standard",
			resultBytes?: number,
		) => {
			const scope = { userId, language, audience, accessClass, type: "user" } as const;
			return executeWithScope(scope, document, resultBytes).pipe(
				Effect.catchIf(
					(error): boolean =>
						error instanceof RyotQLBadRequest &&
						error.reason.code === "invalid-query" &&
						accessClass === "demo" &&
						validateRyotQLDocument(document, { ...scope, accessClass: "standard" }) === null,
					() => new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }),
				),
			);
		};

		const executeForPlugin = (
			scope: Omit<Extract<RyotQLExecutionScope, { type: "plugin" }>, "type">,
			document: RyotQLDocument,
			resultBytes: number,
		) => executeWithScope({ ...scope, type: "plugin" }, document, resultBytes);

		const executeForAdmin = (document: RyotQLDocument) =>
			executeWithScope({ type: "admin" }, document);

		const execute = (user: CurrentUserValue, document: RyotQLDocument, accessClass: AccessClass) =>
			executeForUser(user.id, user.preferences.language, "kernel", document, accessClass);

		const executeForPluginAudience = (
			user: CurrentUserValue,
			document: RyotQLDocument,
			accessClass: AccessClass,
		) => executeForUser(user.id, user.preferences.language, "plugin", document, accessClass);

		return { execute, executeForUser, executeForAdmin, executeForPlugin, executeForPluginAudience };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
