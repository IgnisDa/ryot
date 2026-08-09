import { BunHttpServer } from "@effect/platform-bun";
import { AppContract } from "@ryot/contract/contract";
import { BadRequest } from "@ryot/contract/errors";
import { Cause, Effect, FileSystem, Layer, Result, Schema } from "effect";
import {
	HttpEffect,
	HttpMiddleware,
	HttpRouter,
	HttpServer,
	HttpServerRequest,
	HttpServerResponse,
} from "effect/unstable/http";
import { HttpApiBuilder, HttpApiError, HttpApiScalar } from "effect/unstable/httpapi";

import { AppConfig } from "#lib/infrastructure/config/service";
import { RequestLogUrl } from "#lib/infrastructure/request-log-url";
import { AdminMiddlewareLive, AuthMiddlewareLive, AuthService } from "#modules/auth/service";
import { AutomationsRoutesLive } from "#modules/automations/routes";
import { BackupsRoutesLive } from "#modules/backups/routes";
import { CollectionsRoutesLive } from "#modules/collections/routes";
import { DefinitionsRoutesLive } from "#modules/definitions/routes";
import { EntitiesRoutesLive } from "#modules/entities/routes";
import { InterestRoutesLive } from "#modules/entity-interest/routes";
import { InterestSocketRouteLive } from "#modules/entity-interest/socket-route";
import { EventsRoutesLive } from "#modules/events/routes";
import { GodModeRoutesLive } from "#modules/god-mode/routes";
import { ImportsRoutesLive } from "#modules/imports/routes";
import { IntegrationsRoutesLive } from "#modules/integrations/routes";
import { NotificationsRoutesLive } from "#modules/notifications/routes";
import { PluginArtifactSessionsRoutesLive, PluginsRoutesLive } from "#modules/plugins/routes";
import { ProviderEntitiesRoutesLive } from "#modules/provider-entities/routes";
import { RelationshipsRoutesLive } from "#modules/relationships/routes";
import { RyotQLRoutesLive } from "#modules/ryotql/routes";
import { SavedViewsRoutesLive } from "#modules/saved-views/routes";
import { SystemRoutesLive } from "#modules/system/routes";
import { TestSupportRoutesLive } from "#modules/test-support/routes";
import { LocalUploadsRoutesLive, UploadsRoutesLive } from "#modules/uploads/routes";
import { UserSettingsRoutesLive } from "#modules/user-settings/routes";
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

const ApiLive = HttpApiBuilder.layer(AppContract).pipe(
	Layer.provide(Layer.mergeAll(SystemRoutesLive, AutomationsRoutesLive)),
	Layer.provide(DefinitionsRoutesLive),
	Layer.provide(BackupsRoutesLive),
	Layer.provide(RelationshipsRoutesLive),
	Layer.provide(EntitiesRoutesLive),
	Layer.provide(ProviderEntitiesRoutesLive),
	Layer.provide(Layer.mergeAll(UserStateRoutesLive, UserSettingsRoutesLive)),
	Layer.provide(EventsRoutesLive),
	Layer.provide(UploadsRoutesLive),
	Layer.provide(LocalUploadsRoutesLive),
	Layer.provide(PluginArtifactSessionsRoutesLive),
	Layer.provide(SavedViewsRoutesLive),
	Layer.provide(PluginsRoutesLive),
	Layer.provide(CollectionsRoutesLive),
	Layer.provide(Layer.mergeAll(GodModeRoutesLive, TestSupportRoutesLive)),
	Layer.provide(ImportsRoutesLive),
	Layer.provide(Layer.mergeAll(IntegrationsRoutesLive, NotificationsRoutesLive)),
	Layer.provide(Layer.mergeAll(RyotQLRoutesLive, InterestRoutesLive)),
	Layer.provide(Layer.mergeAll(AuthMiddlewareLive, AdminMiddlewareLive)),
);

const ScalarLive = HttpApiScalar.layer(AppContract, { path: "/docs" });

const DecodeErrorsAsBadRequestLive = HttpRouter.middleware(decodeErrorsAsBadRequest, {
	global: true,
});

const ApiWithScalarLive = Layer.mergeAll(
	ApiLive,
	ScalarLive,
	InterestSocketRouteLive,
	DecodeErrorsAsBadRequestLive,
);

export const registerRootRoutes = Effect.fn("registerRootRoutes")(function* <E, R, SE, SR>(
	router: HttpRouter.HttpRouter,
	api: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
	authHandler: (request: Request) => Promise<Response>,
	serveStatic: (pathname: string) => Effect.Effect<HttpServerResponse.HttpServerResponse, SE, SR>,
	frontendUrl: string,
) {
	const cors = HttpMiddleware.cors({ allowedOrigins: ["*"], credentials: false });
	yield* router.addGlobalMiddleware(cors);
	yield* router.add("*", "/api/auth/*", (request) =>
		HttpEffect.fromWebHandler(authHandler).pipe(
			Effect.provideService(HttpServerRequest.HttpServerRequest, request),
		),
	);
	yield* router.add("*", "/_i/*", (request) => {
		const [pathname, search = ""] = request.url.split("?", 2);
		const rewritten = `/webhooks/integrations/${pathname?.slice(4) ?? ""}${search ? `?${search}` : ""}`;
		return api.pipe(
			Effect.provideService(
				HttpServerRequest.HttpServerRequest,
				request.modify({ url: rewritten }),
			),
		);
	});
	yield* router.prefixed("/api").add("*", "*", api);
	yield* router.add("*", "*", (request) => {
		const url = new URL(request.originalUrl, frontendUrl);
		if (url.pathname.startsWith("/api/")) {
			return Effect.succeed(HttpServerResponse.empty({ status: 404 }));
		}
		return serveStatic(url.pathname);
	});
});

const requestLogger = HttpMiddleware.make((httpApp) =>
	Effect.gen(function* () {
		const logUrl = yield* RequestLogUrl;
		const request = yield* HttpServerRequest.HttpServerRequest;
		const url = yield* logUrl.resolve(request);
		return yield* Effect.provideService(
			HttpMiddleware.logger(
				Effect.provideService(httpApp, HttpServerRequest.HttpServerRequest, request),
			),
			HttpServerRequest.HttpServerRequest,
			request.modify({ url }),
		);
	}),
);

// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect router registration, not React.
const RootRoutesLive = HttpRouter.use((router) =>
	Effect.gen(function* () {
		const auth = yield* AuthService;
		const config = yield* AppConfig;
		const fs = yield* FileSystem.FileSystem;
		const api = yield* HttpRouter.toHttpEffect(ApiWithScalarLive);

		const serveStatic = Effect.fn("serveStatic")(function* (pathname: string) {
			const path =
				pathname === "/"
					? `${config.server.clientDir}/index.html`
					: `${config.server.clientDir}${pathname}`;
			const exists = yield* fs.exists(path);
			const target = exists ? path : `${config.server.clientDir}/index.html`;
			const bytes = yield* fs.readFile(target);
			return HttpServerResponse.uint8Array(bytes, { contentType: mimeType(target) });
		});

		yield* registerRootRoutes(router, api, auth.auth.handler, serveStatic, config.frontendUrl);
	}),
);

const BunServerLive = Layer.unwrap(
	Effect.map(AppConfig, (config) =>
		BunHttpServer.layer({
			idleTimeout: 60,
			port: config.port,
			websocket: { idleTimeout: 60, maxPayloadLength: 1024 * 1024 },
		}),
	),
);

const ListeningLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const server = yield* HttpServer.HttpServer;
		yield* Effect.logInfo("app backend listening").pipe(
			Effect.annotateLogs({ url: HttpServer.formatAddress(server.address) }),
		);
		return yield* Effect.never;
	}),
);

export const ServerLive = Layer.mergeAll(
	HttpRouter.serve(RootRoutesLive, {
		disableLogger: true,
		disableListenLog: true,
		middleware: requestLogger,
	}),
	ListeningLive,
).pipe(Layer.provide(RequestLogUrl.layer), Layer.provide(BunServerLive));
