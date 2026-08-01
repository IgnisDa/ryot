import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { PluginCatalogHub } from "./catalog-events";
import { PluginClientArtifactSessionService } from "./client-artifact-session-service";
import { PluginInstallationService } from "./installation-service";
import { OperationsService } from "./operations-service";

export const pluginArtifactSessionResponse = (file: {
	readonly contents: Uint8Array;
	readonly contentType: string;
}) => {
	return HttpServerResponse.uint8Array(file.contents, {
		contentType: file.contentType,
		headers: {
			"access-control-allow-origin": "*",
			"x-content-type-options": "nosniff",
			"cache-control": "no-store",
			"referrer-policy": "no-referrer",
			...(file.contentType.startsWith("text/html")
				? { "content-security-policy": "sandbox allow-scripts" }
				: {}),
		},
	});
};

export const PluginArtifactSessionsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"pluginArtifactSessions",
	(handlers) =>
		handlers.handleRaw("file", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* PluginClientArtifactSessionService;
				return yield* service
					.findFile(params.token, params.fileName)
					.pipe(dieOnDbError, Effect.map(pluginArtifactSessionResponse));
			}),
		),
);

export const PluginsRoutesLive = HttpApiBuilder.group(AppContract, "plugins", (handlers) =>
	handlers
		.handle("list", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PluginInstallationService;
				return yield* service.listInstallations(user.id).pipe(dieOnDbError);
			}),
		)
		.handleRaw("events", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const hub = yield* PluginCatalogHub;
				return HttpServerResponse.stream(hub.stream(user.id), {
					headers: {
						connection: "keep-alive",
						"x-accel-buffering": "no",
						"cache-control": "no-cache",
						"content-type": "text/event-stream",
					},
				});
			}),
		)
		.handle("install", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PluginInstallationService;
				return yield* service
					.installPrivatePlugin({
						userId: user.id,
						config: payload.config,
						uploadToken: payload.uploadToken,
					})
					.pipe(dieOnDbError);
			}),
		)
		.handle("update", ({ params, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PluginInstallationService;
				return yield* service
					.updatePrivatePlugin({
						userId: user.id,
						config: payload.config,
						pluginSlug: params.pluginSlug,
						uploadToken: payload.uploadToken,
						unsetConfigKeys: payload.unsetConfigKeys,
					})
					.pipe(dieOnDbError);
			}),
		)
		.handle("uninstall", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PluginInstallationService;
				return yield* service.uninstallPlugin(user.id, params.pluginSlug).pipe(dieOnDbError);
			}),
		)
		.handle("setHomeView", ({ params, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PluginInstallationService;
				return yield* service.setHomeView(user.id, params.pluginSlug, payload).pipe(dieOnDbError);
			}),
		)
		.handle("createArtifactSession", ({ params, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PluginClientArtifactSessionService;
				return yield* service.create({ userId: user.id, ...params, ...payload }).pipe(dieOnDbError);
			}),
		)
		.handle("renewArtifactSession", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PluginClientArtifactSessionService;
				return yield* service
					.renew({ userId: user.id, sessionId: params.sessionId })
					.pipe(dieOnDbError);
			}),
		)
		.handle("revokeArtifactSession", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PluginClientArtifactSessionService;
				return yield* service
					.revoke({ userId: user.id, sessionId: params.sessionId })
					.pipe(dieOnDbError);
			}),
		)
		.handle("invoke", ({ params, payload }) =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest;
				const service = yield* OperationsService;
				const result = yield* service
					.invoke({
						payload: payload.payload,
						headers: request.headers,
						pluginSlug: params.pluginSlug,
						operationSlug: params.operationSlug,
						...(payload.sourceHash === undefined ? {} : { sourceHash: payload.sourceHash }),
					})
					.pipe(dieOnDbError);
				return { result };
			}),
		),
);
