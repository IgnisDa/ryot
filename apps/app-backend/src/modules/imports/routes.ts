import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "#lib/auth";
import { AppContract } from "#lib/contract";
import { dieOnDbError } from "#lib/errors";

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
		.handle("getRun", ({ path, urlParams }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* ImportsService;
				const query = { page: urlParams.page ?? 1, limit: urlParams.limit ?? 20 };
				return yield* service.getImportRun(user, path.runId, query).pipe(dieOnDbError);
			}),
		)
		.handle("deleteRun", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* ImportsService;
				return yield* service.removeImportRun(user, path.runId).pipe(dieOnDbError);
			}),
		),
);
