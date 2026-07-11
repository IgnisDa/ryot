import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, DbError, NotFound, dieOnDbError } from "@ryot/contract/errors";
import type { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import type { PluginSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	DbRunner,
	TransactionRunner,
	setLocalStatementTimeout,
} from "#lib/infrastructure/db/service";
import { DefinitionRegistry } from "#modules/definition-registry/service";

import type { PluginQuerySchemaOwnership, QueryExecutionScope } from "./execution-scope";
import { executeAggregateQuery } from "./executor/aggregate";
import { executeRowsQuery } from "./executor/rows";
import { executeTimeSeriesQuery } from "./executor/time-series";
import type {
	AggregateQueryDocument,
	RowsQueryDocument,
	TimeSeriesQueryDocument,
} from "./executor/types";
import { validateQueryDocument, validateQueryDocumentWithScope } from "./validator/document";
import { validateQueryDocumentReferencesAndTypes } from "./validator/references";
import { validateQueryDocumentTypeCompatibility } from "./validator/type-check";

const QUERY_ENGINE_STATEMENT_TIMEOUT_MS = 30_000;

const isRowsQueryDocument = (doc: QueryDocument): doc is RowsQueryDocument =>
	doc.output.type === "rows";

const isAggregateQueryDocument = (doc: QueryDocument): doc is AggregateQueryDocument =>
	doc.output.type === "aggregate";

const isTimeSeriesQueryDocument = (doc: QueryDocument): doc is TimeSeriesQueryDocument =>
	doc.output.type === "timeSeries";

export class QueryEngineService extends Effect.Service<QueryEngineService>()("QueryEngineService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const runInTx = yield* TransactionRunner;
		const definitions = yield* DefinitionRegistry;
		const withDefinitions = <A, E, R>(effect: Effect.Effect<A, E, R | DefinitionRegistry>) =>
			Effect.provideService(effect, DefinitionRegistry, definitions);

		const runBounded = <A, R>(effect: Effect.Effect<A, BadRequest | NotFound | DbError, R>) =>
			runInTx(
				withDefinitions(
					Effect.gen(function* () {
						yield* setLocalStatementTimeout(QUERY_ENGINE_STATEMENT_TIMEOUT_MS);
						return yield* effect;
					}),
				),
			).pipe(
				// A statement_timeout abort (57014) means the query was too expensive to serve within the
				// limit; surface it as a 400 instead of letting dieOnDbError turn it into a 500.
				Effect.catchIf(
					(error): error is DbError => error instanceof DbError,
					(error) =>
						Effect.fail(
							error.code === "57014"
								? new BadRequest({
										message: `Query exceeded the maximum execution time of ${QUERY_ENGINE_STATEMENT_TIMEOUT_MS}ms`,
									})
								: error,
						),
				),
			);

		const validate = Effect.fn("QueryEngineService.validate")(function* (
			user: Pick<CurrentUserValue, "id">,
			doc: QueryDocument,
		) {
			const executionScope = { type: "user", userId: user.id } as const;
			const validationError = validateQueryDocument(doc);
			if (validationError) {
				return yield* new BadRequest({ message: validationError });
			}

			yield* runWithDb(
				withDefinitions(validateQueryDocumentReferencesAndTypes(executionScope, doc)),
			).pipe(
				Effect.catchIf(
					(error): error is NotFound => error instanceof NotFound,
					(error) => Effect.fail(new BadRequest({ message: error.message })),
				),
			);
			return undefined;
		});

		const executeDocument = Effect.fn("QueryEngineService.executeDocument")(function* (
			executionScope: QueryExecutionScope,
			language: string | null,
			doc: QueryDocument,
		) {
			const { error, scope } = validateQueryDocumentWithScope(doc);
			if (error) {
				return yield* new BadRequest({ message: error });
			}

			yield* runWithDb(
				withDefinitions(validateQueryDocumentTypeCompatibility(executionScope, doc, scope)),
			);

			if (isRowsQueryDocument(doc)) {
				return yield* runBounded(executeRowsQuery(executionScope, language, doc));
			}

			if (isAggregateQueryDocument(doc)) {
				return yield* runBounded(executeAggregateQuery(executionScope, language, doc));
			}

			if (isTimeSeriesQueryDocument(doc)) {
				return yield* runBounded(executeTimeSeriesQuery(executionScope, language, doc));
			}

			return yield* new BadRequest({ message: "Unsupported query output type" });
		}, dieOnDbError);

		const executeForUser = (userId: string, language: string | null, doc: QueryDocument) =>
			executeDocument({ type: "user", userId }, language, doc);
		const execute = (user: CurrentUserValue, doc: QueryDocument) =>
			executeForUser(user.id, user.preferences.language, doc);

		const executeSystem = Effect.fn("QueryEngineService.executeSystem")(function* (
			input: { readonly pluginSlug: PluginSlug } & PluginQuerySchemaOwnership,
			doc: QueryDocument,
		) {
			const executionScope = { type: "system" as const, ...input };
			const validationError = validateQueryDocument(doc);
			if (validationError) {
				return yield* new BadRequest({ message: validationError });
			}
			yield* runWithDb(
				withDefinitions(validateQueryDocumentReferencesAndTypes(executionScope, doc)),
			).pipe(
				Effect.catchIf(
					(error): error is NotFound => error instanceof NotFound,
					(error) => Effect.fail(new BadRequest({ message: error.message })),
				),
			);
			return yield* executeDocument(executionScope, null, doc);
		}, dieOnDbError);

		return { execute, validate, executeForUser, executeSystem };
	}),
}) {}
