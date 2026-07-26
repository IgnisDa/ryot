import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ImportsService } from "./service";

export const ImportsRoutesLive = HttpApiBuilder.group(AppContract, "imports", (handlers) =>
	handlers
		.handle("listSources", () =>
			Effect.gen(function* () {
				const service = yield* ImportsService;
				return yield* service.listImportSources().pipe(dieOnDbError);
			}),
		)
		.handle("createRun", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* ImportsService;
				return yield* service.startImportRun(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("deleteRun", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* ImportsService;
				return yield* service.removeImportRun(user, params.runId).pipe(dieOnDbError);
			}),
		),
);
