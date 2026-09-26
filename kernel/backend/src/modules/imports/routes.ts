import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ImportRunCancellationService } from "./cancellation-service";
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
		.handle("cancelRun", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* ImportRunCancellationService;
				return yield* service.cancelRun(user, params.runId).pipe(dieOnDbError);
			}),
		)
		.handle("deleteRun", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* ImportsService;
				return yield* service.removeImportRun(user, params.runId).pipe(dieOnDbError);
			}),
		)
		.handleRaw("downloadFailures", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* ImportsService;
				const download = yield* service.downloadFailures(user, params.runId).pipe(dieOnDbError);
				return HttpServerResponse.stream(download.stream, {
					headers: {
						"cache-control": "no-store",
						"content-type": "application/json; charset=utf-8",
						"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(download.fileName)}`,
					},
				});
			}),
		),
);
