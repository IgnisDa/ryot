import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "#lib/auth-middleware";
import { AppContract } from "#lib/contract";
import { dieOnDbError } from "#lib/errors";

import { EntityImportService } from "./service";

export const EntityImportRoutesLive = HttpApiBuilder.group(
	AppContract,
	"entityImport",
	(handlers) =>
		handlers
			.handle("import", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntityImportService;
					return yield* service.import(user, payload).pipe(dieOnDbError);
				}),
			)
			.handle("getImportResult", ({ path }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntityImportService;
					return yield* service.getImportResult(user, path.jobId);
				}),
			),
);
