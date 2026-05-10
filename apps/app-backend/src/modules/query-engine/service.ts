import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
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
			execute: Effect.fn("QueryEngineService.execute")(function* (
				user: CurrentUserValue,
				request: QueryEngineRequest,
			) {
				return yield* runWithDb(prepareAndExecute(user.id, request));
			}, dieOnDbError),
			validateSavedView: Effect.fn("QueryEngineService.validateSavedView")(function* (
				user: CurrentUserValue,
				input: {
					queryDefinition: SavedViewQueryDefinition;
					displayConfiguration: DisplayConfiguration;
				},
			) {
				return yield* runWithDb(loadAndValidateQueryContext({ userId: user.id, ...input }));
			}, dieOnDbError),
		};
	}),
}) {}
