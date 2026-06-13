import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { DbRunner } from "#lib/db";
import { BadRequest, dieOnDbError } from "#lib/errors";

import { executeAggregateQuery, executeRowsQuery, executeTimeSeriesQuery } from "./executor";
import type {
	AggregateOutputV2,
	QueryDocumentV2,
	RowsOutputV2,
	TimeSeriesOutputV2,
} from "./language";
import { validateQueryDocumentV2 } from "./validator";

type RowsQueryDocumentV2 = QueryDocumentV2 & { output: RowsOutputV2 };
type AggregateQueryDocumentV2 = QueryDocumentV2 & { output: AggregateOutputV2 };
type TimeSeriesQueryDocumentV2 = QueryDocumentV2 & { output: TimeSeriesOutputV2 };

const isRowsQueryDocument = (doc: QueryDocumentV2): doc is RowsQueryDocumentV2 =>
	doc.output.type === "rows";

const isAggregateQueryDocument = (doc: QueryDocumentV2): doc is AggregateQueryDocumentV2 =>
	doc.output.type === "aggregate";

const isTimeSeriesQueryDocument = (doc: QueryDocumentV2): doc is TimeSeriesQueryDocumentV2 =>
	doc.output.type === "timeSeries";

export class QueryEngineV2Service extends Effect.Service<QueryEngineV2Service>()(
	"QueryEngineV2Service",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;

			return {
				execute: Effect.fn("QueryEngineV2Service.execute")(function* (
					user: CurrentUserValue,
					doc: QueryDocumentV2,
				) {
					const validationError = validateQueryDocumentV2(doc);
					if (validationError) {
						return yield* new BadRequest({ message: validationError });
					}

					if (isRowsQueryDocument(doc)) {
						return yield* runWithDb(executeRowsQuery(user.id, doc));
					}

					if (isAggregateQueryDocument(doc)) {
						return yield* runWithDb(executeAggregateQuery(user.id, doc));
					}

					if (isTimeSeriesQueryDocument(doc)) {
						return yield* runWithDb(executeTimeSeriesQuery(user.id, doc));
					}

					return yield* new BadRequest({ message: "Unsupported v2 query output type" });
				}, dieOnDbError),
			};
		}),
	},
) {}
