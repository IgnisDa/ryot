import { Effect } from "effect";

import type { CurrentUserValue } from "~/lib/auth";
import { DbRunner } from "~/lib/db";
import { dieOnDbError } from "~/lib/errors";
import type { QueryEngineRequest } from "~/lib/query-language";

import { prepareAndExecute } from "./preparer";

export class QueryEngineService extends Effect.Service<QueryEngineService>()("QueryEngineService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;

		return {
			execute: (user: CurrentUserValue, request: QueryEngineRequest) =>
				runWithDb(prepareAndExecute(user.id, request)).pipe(dieOnDbError),
		};
	}),
}) {}
