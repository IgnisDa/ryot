import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { PluginInstallationService } from "./installation-service";
import { OperationsService } from "./operations-service";

export const PluginsRoutesLive = HttpApiBuilder.group(AppContract, "plugins", (handlers) =>
	handlers
		.handle("list", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PluginInstallationService;
				return yield* service.listInstallations(user.id).pipe(dieOnDbError);
			}),
		)
		.handle("install", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PluginInstallationService;
				return yield* service
					.installPrivatePlugin({
						userId: user.id,
						files: payload.files,
						config: payload.config,
						manifest: payload.manifest,
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
						files: payload.files,
						config: payload.config,
						manifest: payload.manifest,
						pluginSlug: params.pluginSlug,
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
					})
					.pipe(dieOnDbError);
				return { result };
			}),
		),
);
