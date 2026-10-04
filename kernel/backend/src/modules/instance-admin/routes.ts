import { AppContract } from "@ryot-app/contract/contract";
import { DbError } from "@ryot-app/contract/errors";
import { GodModeInternalFailure } from "@ryot-app/contract/modules/god-mode/contract";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { streamDownloadResponse } from "#platform/http/download-response";
import { downloadTicketUrl } from "#platform/storage/download-tickets";

import { ServerLogs } from "./logs";
import { InstanceAdminService } from "./service";

const mapPersistenceFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.catchIf(
			(error): error is Extract<E, DbError> => error instanceof DbError,
			() => Effect.fail(new GodModeInternalFailure({ reason: { code: "persistence-failed" } })),
		),
	);

export const InstanceAdminRoutesLive = HttpApiBuilder.group(AppContract, "godMode", (handlers) =>
	handlers
		.handle("startUserImpersonation", ({ params, payload }) =>
			Effect.gen(function* () {
				const service = yield* InstanceAdminService;
				return yield* mapPersistenceFailure(service.startUserImpersonation(params.userId, payload));
			}),
		)
		.handle("provisionUser", ({ payload }) =>
			Effect.gen(function* () {
				const service = yield* InstanceAdminService;
				return yield* mapPersistenceFailure(service.provisionUser(payload));
			}),
		)
		.handle("resetUserPassword", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* InstanceAdminService;
				return yield* mapPersistenceFailure(service.resetUserPassword(params.userId));
			}),
		)
		.handle("resetUser", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* InstanceAdminService;
				return yield* mapPersistenceFailure(service.resetUser(params.userId));
			}),
		)
		.handle("setUserDisabled", ({ params, payload }) =>
			Effect.gen(function* () {
				const service = yield* InstanceAdminService;
				return yield* mapPersistenceFailure(
					service.setUserDisabled(params.userId, payload.disabled),
				);
			}),
		)
		.handle("deleteUser", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* InstanceAdminService;
				return yield* mapPersistenceFailure(service.deleteUser(params.userId));
			}),
		),
);

export const ServerLogsRoutesLive = HttpApiBuilder.group(AppContract, "serverLogs", (handlers) =>
	handlers
		.handle("list", ({ query }) =>
			Effect.flatMap(ServerLogs, (service) => service.list(query.after, query.limit)),
		)
		.handle("createFileDownloadTicket", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* ServerLogs;
				const ticket = yield* service.createFileDownloadTicket(params.id);
				return {
					url: downloadTicketUrl(
						`/god-mode/logs/files/${encodeURIComponent(params.id)}/download`,
						ticket,
					),
				};
			}),
		)
		.handle("createAllDownloadTicket", () =>
			Effect.gen(function* () {
				const service = yield* ServerLogs;
				const ticket = yield* service.createAllDownloadTicket();
				return { url: downloadTicketUrl("/god-mode/logs/download", ticket) };
			}),
		),
);

export const ServerLogDownloadsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"serverLogDownloads",
	(handlers) =>
		handlers
			.handleRaw("downloadFile", ({ query, params }) =>
				Effect.gen(function* () {
					const service = yield* ServerLogs;
					const download = yield* service.downloadFileWithTicket(params.id, query.ticket);
					return streamDownloadResponse(download.stream, {
						fileName: download.fileName,
						contentLength: download.size,
						contentType: download.fileName.endsWith(".gz")
							? "application/gzip"
							: "text/plain; charset=utf-8",
					});
				}),
			)
			.handleRaw("downloadAll", ({ query }) =>
				Effect.gen(function* () {
					const service = yield* ServerLogs;
					const download = yield* service.downloadAllWithTicket(query.ticket);
					return streamDownloadResponse(download.stream, {
						fileName: download.fileName,
						contentType: "application/zip",
					});
				}),
			),
);
