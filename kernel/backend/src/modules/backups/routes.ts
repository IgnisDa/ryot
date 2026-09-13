import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { streamDownloadResponse } from "#lib/infrastructure/download-response";
import { downloadTicketUrl } from "#lib/infrastructure/download-tickets";

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
		.handle("createDownloadTicket", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* BackupsService;
				const ticket = yield* service.createDownloadTicket(user, params.id);
				return {
					url: downloadTicketUrl(`/backups/runs/${encodeURIComponent(params.id)}/download`, ticket),
				};
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

export const BackupDownloadsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"backupDownloads",
	(handlers) =>
		handlers.handleRaw("downloadRun", ({ query, params }) =>
			Effect.gen(function* () {
				const service = yield* BackupsService;
				const download = yield* service.downloadRunWithTicket(params.id, query.ticket);
				return streamDownloadResponse(download.stream, {
					fileName: download.fileName,
					contentLength: download.size,
					contentType: "application/zip",
				});
			}),
		),
);
