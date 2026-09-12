import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { streamDownloadResponse } from "#lib/infrastructure/download-response";
import { downloadTicketUrl } from "#lib/infrastructure/download-tickets";

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
		.handle("createFailuresDownloadTicket", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* ImportsService;
				const ticket = yield* service
					.createFailuresDownloadTicket(user, params.runId)
					.pipe(dieOnDbError);
				return {
					url: downloadTicketUrl(
						`/imports/runs/${encodeURIComponent(params.runId)}/failures/download`,
						ticket,
					),
				};
			}),
		),
);

export const ImportDownloadsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"importDownloads",
	(handlers) =>
		handlers.handleRaw("downloadFailures", ({ query, params }) =>
			Effect.gen(function* () {
				const service = yield* ImportsService;
				const download = yield* service
					.downloadFailuresWithTicket(query.ticket, params.runId)
					.pipe(dieOnDbError);
				return streamDownloadResponse(download.stream, {
					fileName: download.fileName,
					contentType: "application/json; charset=utf-8",
				});
			}),
		),
);
