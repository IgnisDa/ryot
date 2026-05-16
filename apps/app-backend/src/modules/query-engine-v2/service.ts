import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { DbRunner } from "#lib/db";
import { BadRequest, dieOnDbError } from "#lib/errors";

import { executeRowsQuery } from "./executor";
import type { QueryDocumentV2 } from "./language";
import { validateQueryDocumentV2 } from "./validator";

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

					return yield* runWithDb(executeRowsQuery(user.id, doc));
				}, dieOnDbError),
			};
		}),
	},
) {}
