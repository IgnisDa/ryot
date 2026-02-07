import { BunHttpServer } from "@effect/platform-bun";
import { AppContract } from "@ryot/contract/contract";
import { BadRequest } from "@ryot/contract/errors";
import { Cause, Context, Effect, Layer, FileSystem, Result, Schema } from "effect";
import type * as LayerTypes from "effect/Layer";
import {
	HttpEffect,
	HttpRouter,
	HttpServer,
	HttpServerRequest,
	HttpServerResponse,
} from "effect/unstable/http";
import { HttpApiBuilder, HttpApiError, HttpApiScalar } from "effect/unstable/httpapi";

import { AppConfig } from "#lib/infrastructure/config/service";
import { AdminMiddlewareLive, AuthMiddlewareLive, AuthService } from "#modules/auth/service";
import { AutomationsRoutesLive } from "#modules/automations/routes";
import { CollectionsRoutesLive } from "#modules/collections/routes";
import { DefinitionsRoutesLive } from "#modules/definitions/routes";
import { EntitiesRoutesLive } from "#modules/entities/routes";
import { EntityImportRoutesLive } from "#modules/entity-import/routes";
import { InterestRoutesLive } from "#modules/entity-interest/routes";
import { EventsRoutesLive } from "#modules/events/routes";
import { GodModeRoutesLive } from "#modules/god-mode/routes";
import { ImportsRoutesLive } from "#modules/imports/routes";
import { IntegrationsRoutesLive } from "#modules/integrations/routes";
import { NotificationsRoutesLive } from "#modules/notifications/routes";
import { PluginsRoutesLive } from "#modules/plugins/routes";
import { QueryEngineRoutesLive } from "#modules/query-engine/routes";
import { RelationshipsRoutesLive } from "#modules/relationships/routes";
import { SavedViewsRoutesLive } from "#modules/saved-views/routes";
import { SystemRoutesLive } from "#modules/system/routes";
import { TestSupportRoutesLive } from "#modules/test-support/routes";
import { UploadsRoutesLive } from "#modules/uploads/routes";
import { UserPreferencesRoutesLive } from "#modules/user-preferences/routes";
import { UserStateRoutesLive } from "#modules/user-state/routes";

const mimeTypes: Record<string, string> = {
	ttf: "font/ttf",
	otf: "font/otf",
	png: "image/png",
	gif: "image/gif",
	jpg: "image/jpeg",
	woff: "font/woff",
	jpeg: "image/jpeg",
	webp: "image/webp",
	avif: "image/avif",
	ico: "image/x-icon",
	woff2: "font/woff2",
	svg: "image/svg+xml",
	wasm: "application/wasm",
	css: "text/css; charset=utf-8",
	txt: "text/plain; charset=utf-8",
	map: "application/json; charset=utf-8",
	json: "application/json; charset=utf-8",
	webmanifest: "application/manifest+json",
	js: "application/javascript; charset=utf-8",
	mjs: "application/javascript; charset=utf-8",
};

const mimeType = (path: string) => {
	const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	return mimeTypes[extension] ?? "text/html; charset=utf-8";
};

const decodeErrorsAsBadRequest = Effect.catchCause((cause) => {
	const defect = Cause.findDefect(cause);
	if (Result.isSuccess(defect) && HttpApiError.HttpApiSchemaError.is(defect.success)) {
		return Schema.encodeUnknownEffect(BadRequest)(
			new BadRequest({ message: String(defect.success.cause) }),
		).pipe(
			Effect.flatMap((body) => HttpServerResponse.json(body, { status: 400 })),
			Effect.orDie,
		);
	}
	return Effect.failCause(cause);
});

const buildWebhookForwardRequest = (request: Request, url: URL) =>
	new Request(url.toString(), request);

const ApiLive = HttpApiBuilder.layer(AppContract).pipe(
	Layer.provide(Layer.mergeAll(SystemRoutesLive, AutomationsRoutesLive)),
	Layer.provide(DefinitionsRoutesLive),
	Layer.provide(RelationshipsRoutesLive),
	Layer.provide(EntitiesRoutesLive),
	Layer.provide(EntityImportRoutesLive),
	Layer.provide(Layer.mergeAll(UserStateRoutesLive, UserPreferencesRoutesLive)),
	Layer.provide(EventsRoutesLive),
	Layer.provide(UploadsRoutesLive),
	Layer.provide(SavedViewsRoutesLive),
	Layer.provide(PluginsRoutesLive),
	Layer.provide(CollectionsRoutesLive),
	Layer.provide(Layer.mergeAll(GodModeRoutesLive, TestSupportRoutesLive)),
	Layer.provide(ImportsRoutesLive),
	Layer.provide(Layer.mergeAll(IntegrationsRoutesLive, NotificationsRoutesLive)),
	Layer.provide(Layer.mergeAll(QueryEngineRoutesLive, InterestRoutesLive)),
	Layer.provide(AuthMiddlewareLive),
	Layer.provide(AdminMiddlewareLive),
);

const ScalarLive = HttpApiScalar.layer(AppContract, { path: "/docs" });

const DecodeErrorsAsBadRequestLive = HttpRouter.middleware(decodeErrorsAsBadRequest, {
	global: true,
});

const ApiWithScalarLive = Layer.mergeAll(ApiLive, ScalarLive, DecodeErrorsAsBadRequestLive);

type ApiRequirements = LayerTypes.Services<typeof ApiWithScalarLive>;

type ApiContext =
	| HttpRouter.Request.Without<ApiRequirements>
	| HttpRouter.Request.Only<"Requires", ApiRequirements>;

export const ServerLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const auth = yield* AuthService;
		const config = yield* AppConfig;
		const fs = yield* FileSystem.FileSystem;
		const apiContext = yield* Effect.map(
			Effect.context<ApiContext>(),
			Context.omit(HttpRouter.HttpRouter),
		);
		const { dispose, handler } = HttpRouter.toWebHandler(
			ApiWithScalarLive.pipe(
				Layer.provide(Layer.succeedContext(apiContext)),
				Layer.provide(BunHttpServer.layerHttpServices),
			),
		);
		yield* Effect.addFinalizer(() => Effect.promise(dispose));

		const serveStatic = Effect.fn("serveStatic")(function* (pathname: string) {
			const path = pathname === "/" ? "./client/index.html" : `./client${pathname}`;
			const exists = yield* fs.exists(path);
			const target = exists ? path : "./client/index.html";
			const bytes = yield* fs.readFile(target);
			return new Response(bytes, { headers: { "Content-Type": mimeType(target) } });
		});

		const server = yield* BunHttpServer.make({ port: config.port });
		yield* HttpServer.serveEffect(
			Effect.gen(function* () {
				const serverRequest = yield* HttpServerRequest.HttpServerRequest;
				const serverUrl = new URL(serverRequest.url, config.frontendUrl);
				if (
					serverUrl.pathname.startsWith("/api/auth/") ||
					serverUrl.pathname.startsWith("/_i/") ||
					serverUrl.pathname.startsWith("/api/")
				) {
					return yield* HttpEffect.fromWebHandler((webRequest) => {
						const webUrl = new URL(webRequest.url);
						if (webUrl.pathname.startsWith("/api/auth/")) {
							return auth.auth.handler(webRequest);
						}
						if (webUrl.pathname.startsWith("/_i/")) {
							webUrl.pathname = `/webhooks/integrations/${webUrl.pathname.slice(4)}`;
							return handler(buildWebhookForwardRequest(webRequest, webUrl), apiContext);
						}
						webUrl.pathname = webUrl.pathname.slice(4);
						return handler(new Request(webUrl.toString(), webRequest), apiContext);
					});
				}
				return HttpServerResponse.fromWeb(yield* serveStatic(serverUrl.pathname));
			}),
		).pipe(Effect.provideService(HttpServer.HttpServer, server));

		yield* Effect.logInfo("app backend listening").pipe(
			Effect.annotateLogs({ url: HttpServer.formatAddress(server.address) }),
		);
		return yield* Effect.never;
	}),
).pipe(Layer.provide(BunHttpServer.layerHttpServices), Layer.provide(HttpRouter.layer));
