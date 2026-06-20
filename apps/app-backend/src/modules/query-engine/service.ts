import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { DbRunner, TransactionRunner, setLocalStatementTimeout } from "#lib/db";
import { BadRequest, DbError, NotFound, dieOnDbError } from "#lib/errors";

import { executeAggregateQuery } from "./executor/aggregate";
import { executeRowsQuery } from "./executor/rows";
import { executeTimeSeriesQuery } from "./executor/time-series";
import type {
	AggregateQueryDocument,
	RowsQueryDocument,
	TimeSeriesQueryDocument,
} from "./executor/types";
import type { QueryDocument } from "./language";
import { validateQueryDocument, validateQueryDocumentWithScope } from "./validator";
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

		const runBounded = <A, R>(effect: Effect.Effect<A, BadRequest | NotFound | DbError, R>) =>
			runInTx(
				Effect.gen(function* () {
					yield* setLocalStatementTimeout(QUERY_ENGINE_STATEMENT_TIMEOUT_MS);
					return yield* effect;
				}),
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
			user: CurrentUserValue,
			doc: QueryDocument,
		) {
			const validationError = validateQueryDocument(doc);
			if (validationError) {
				return yield* new BadRequest({ message: validationError });
			}

			yield* runWithDb(validateQueryDocumentReferencesAndTypes(user.id, doc)).pipe(
				Effect.catchIf(
					(error): error is NotFound => error instanceof NotFound,
					(error) => Effect.fail(new BadRequest({ message: error.message })),
				),
			);
			return undefined;
		}, dieOnDbError);

		const execute = Effect.fn("QueryEngineService.execute")(function* (
			user: CurrentUserValue,
			doc: QueryDocument,
		) {
			const { error, scope } = validateQueryDocumentWithScope(doc);
			if (error) {
				return yield* new BadRequest({ message: error });
			}

			yield* runWithDb(validateQueryDocumentTypeCompatibility(user.id, doc, scope));

			if (isRowsQueryDocument(doc)) {
				return yield* runBounded(executeRowsQuery(user.id, doc));
			}

			if (isAggregateQueryDocument(doc)) {
				return yield* runBounded(executeAggregateQuery(user.id, doc));
			}

			if (isTimeSeriesQueryDocument(doc)) {
				return yield* runBounded(executeTimeSeriesQuery(user.id, doc));
			}

			return yield* new BadRequest({ message: "Unsupported query output type" });
		}, dieOnDbError);

		return { execute, validate };
	}),
}) {}
