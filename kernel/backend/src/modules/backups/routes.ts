import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { BackupsService } from "./service";

export const BackupsRoutesLive = HttpApiBuilder.group(AppContract, "backups", (handlers) =>
	handlers
		.handle("createExport", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* BackupsService;
				return yield* service.createExport(user);
			}),
		)
		.handle("createRestore", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* BackupsService;
				return yield* service.createRestore(user, payload);
			}),
		)
		.handleRaw("downloadRun", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* BackupsService;
				const download = yield* service.downloadRun(user, params.id);
				return HttpServerResponse.stream(download.stream, {
					headers: {
						"content-type": "application/zip",
						"content-length": String(download.size),
						"content-disposition": `attachment; filename="${download.fileName}"`,
					},
				});
			}),
		)
		.handle("deleteRun", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* BackupsService;
				return yield* service.deleteRun(user, params.id);
			}),
		),
);
