import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { DbRunner } from "#lib/db";
import { dieOnDbError } from "#lib/errors";
import type {
	DisplayConfiguration,
	QueryEngineRequest,
	SavedViewQueryDefinition,
} from "#lib/query-language";

import { loadAndValidateQueryContext, prepareAndExecute } from "./preparer";

export class QueryEngineService extends Effect.Service<QueryEngineService>()("QueryEngineService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;

		return {
			execute: (user: CurrentUserValue, request: QueryEngineRequest) =>
				runWithDb(prepareAndExecute(user.id, request)).pipe(dieOnDbError),
			validateSavedView: (
				user: CurrentUserValue,
				input: {
					queryDefinition: SavedViewQueryDefinition;
					displayConfiguration: DisplayConfiguration;
				},
			) => runWithDb(loadAndValidateQueryContext({ userId: user.id, ...input })).pipe(dieOnDbError),
		};
	}),
}) {}
