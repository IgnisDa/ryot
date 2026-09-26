import { AppContract } from "@ryot-app/contract/contract";
import { DbError } from "@ryot-app/contract/errors";
import { GodModeInternalFailure } from "@ryot-app/contract/modules/god-mode/contract";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ServerLogs } from "./logs";
import { GodModeService } from "./service";

const mapPersistenceFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.catchIf(
			(error): error is Extract<E, DbError> => error instanceof DbError,
			() => Effect.fail(new GodModeInternalFailure({ reason: { code: "persistence-failed" } })),
		),
	);

export const GodModeRoutesLive = HttpApiBuilder.group(AppContract, "godMode", (handlers) =>
	handlers
		.handle("provisionUser", ({ payload }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* mapPersistenceFailure(service.provisionUser(payload));
			}),
		)
		.handle("resetUserPassword", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* mapPersistenceFailure(service.resetUserPassword(params.userId));
			}),
		)
		.handle("resetUser", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* mapPersistenceFailure(service.resetUser(params.userId));
			}),
		)
		.handle("setUserDisabled", ({ params, payload }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* mapPersistenceFailure(
					service.setUserDisabled(params.userId, payload.disabled),
				);
			}),
		)
		.handle("deleteUser", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				return yield* mapPersistenceFailure(service.deleteUser(params.userId));
			}),
		),
);

export const ServerLogsRoutesLive = HttpApiBuilder.group(AppContract, "serverLogs", (handlers) =>
	handlers
		.handle("list", ({ query }) =>
			Effect.flatMap(ServerLogs, (service) => service.list(query.after, query.limit)),
		)
		.handleRaw("downloadFile", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* ServerLogs;
				const download = yield* service.downloadFile(params.id);
				return HttpServerResponse.stream(download.stream, {
					contentLength: download.size,
					headers: {
						"cache-control": "no-store",
						"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(download.fileName)}`,
						"content-type": download.fileName.endsWith(".gz")
							? "application/gzip"
							: "text/plain; charset=utf-8",
					},
				});
			}),
		)
		.handleRaw("downloadAll", () =>
			Effect.gen(function* () {
				const service = yield* ServerLogs;
				const download = yield* service.downloadAll();
				return HttpServerResponse.stream(download.stream, {
					headers: {
						"cache-control": "no-store",
						"content-type": "application/zip",
						"content-disposition": `attachment; filename="${download.fileName}"`,
					},
				});
			}),
		),
);
