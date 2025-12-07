import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "#lib/auth-middleware";
import { AppContract } from "#lib/contract";
import { dieOnDbError } from "#lib/errors";

import { LibraryImportService } from "./service";

export const LibraryRoutesLive = HttpApiBuilder.group(AppContract, "entityImport", (handlers) =>
	handlers
		.handle("import", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* LibraryImportService;
				return yield* service.import(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("getImportResult", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* LibraryImportService;
				return yield* service.getImportResult(user, path.jobId);
			}),
		),
);
