import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { PluginCatalogHub } from "./catalog-events";
import { PluginClientArtifactService } from "./client-artifact-service";
import { PluginInstallationService } from "./installation-service";
import { OperationsService } from "./operations-service";

export const PluginArtifactsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"pluginArtifacts",
	(handlers) =>
		handlers.handleRaw("artifact", ({ params }) =>
			Effect.gen(function* () {
				const service = yield* PluginClientArtifactService;
				const file = yield* service
					.findArtifactFile(params.artifactHash, params.fileName)
					.pipe(dieOnDbError);
				if (!file) {
					return HttpServerResponse.empty({ status: 404 });
				}
				return HttpServerResponse.text(file.contents, {
					contentType: file.contentType,
					headers: {
						"access-control-allow-origin": "*",
						"x-content-type-options": "nosniff",
						"cache-control": "public, max-age=31536000, immutable",
						...(file.contentType.startsWith("text/html")
							? { "content-security-policy": "sandbox allow-scripts" }
							: {}),
					},
				});
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
