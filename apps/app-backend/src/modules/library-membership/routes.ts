import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

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
