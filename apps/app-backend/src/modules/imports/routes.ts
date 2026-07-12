import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ImportsService } from "./service";

export const ImportsRoutesLive = HttpApiBuilder.group(AppContract, "imports", (handlers) =>
	handlers
		.handle("createRun", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* ImportsService;
				return yield* service.startImportRun(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("listRuns", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* ImportsService;
				return yield* service.listImportRuns(user).pipe(dieOnDbError);
			}),
		)
		.handle("getRun", ({ params, query }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* ImportsService;
				const pagination = { page: query.page ?? 1, limit: query.limit ?? 20 };
				return yield* service.getImportRun(user, params.runId, pagination).pipe(dieOnDbError);
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
