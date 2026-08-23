import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { PluginCatalogHub } from "./catalog-events";
import { PluginInstallationService } from "./installation-service";
import { OperationsService } from "./operations-service";

export const PluginsRoutesLive = HttpApiBuilder.group(AppContract, "plugins", (handlers) =>
	handlers
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
		.handle("updatePluginState", ({ params, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PluginInstallationService;
				return yield* service
					.updateInstallation(user.id, params.pluginSlug, payload)
					.pipe(dieOnDbError);
			}),
		)
		.handle("setHomeView", ({ params, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PluginInstallationService;
				return yield* service.setHomeView(user.id, params.pluginSlug, payload).pipe(dieOnDbError);
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
