import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { DbRunner } from "#lib/db";
import { BadRequest, NotFound, dieOnDbError } from "#lib/errors";

import { executeAggregateQuery } from "./executor/aggregate";
import { executeRowsQuery } from "./executor/rows";
import { executeTimeSeriesQuery } from "./executor/time-series";
import type { AggregateOutput, QueryDocument, RowsOutput, TimeSeriesOutput } from "./language";
import { validateQueryDocument, validateQueryDocumentWithScope } from "./validator";
import { validateQueryDocumentReferencesAndTypes } from "./validator/references";
import { validateQueryDocumentTypeCompatibility } from "./validator/type-check";

type RowsQueryDocument = QueryDocument & { output: RowsOutput };
type AggregateQueryDocument = QueryDocument & { output: AggregateOutput };
type TimeSeriesQueryDocument = QueryDocument & { output: TimeSeriesOutput };

const isRowsQueryDocument = (doc: QueryDocument): doc is RowsQueryDocument =>
	doc.output.type === "rows";

const isAggregateQueryDocument = (doc: QueryDocument): doc is AggregateQueryDocument =>
	doc.output.type === "aggregate";

const isTimeSeriesQueryDocument = (doc: QueryDocument): doc is TimeSeriesQueryDocument =>
	doc.output.type === "timeSeries";

export class QueryEngineService extends Effect.Service<QueryEngineService>()("QueryEngineService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
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
				return yield* runWithDb(executeRowsQuery(user.id, doc));
			}

			if (isAggregateQueryDocument(doc)) {
				return yield* runWithDb(executeAggregateQuery(user.id, doc));
			}

			if (isTimeSeriesQueryDocument(doc)) {
				return yield* runWithDb(executeTimeSeriesQuery(user.id, doc));
			}

			return yield* new BadRequest({ message: "Unsupported query output type" });
		}, dieOnDbError);

		return { execute, validate };
	}),
}) {}
