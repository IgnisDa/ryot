import {
	FileSystem,
	HttpApiBuilder,
	HttpApiScalar,
	HttpApp,
	HttpMiddleware,
	HttpServer,
} from "@effect/platform";
import type { HttpApiError } from "@effect/platform";
import { BunHttpServer } from "@effect/platform-bun";
import { AppContract } from "@ryot/contract/contract";
import { BadRequest } from "@ryot/contract/errors";
import { UploadBodyLimitMiddlewareLive } from "@ryot/contract/modules/uploads/middleware";
import { Effect, Layer, Runtime } from "effect";
import type * as LayerTypes from "effect/Layer";

import { AppConfig } from "#lib/infrastructure/config/service";
import { AdminMiddlewareLive, AuthMiddlewareLive, AuthService } from "#modules/auth/service";
import { AutomationsRoutesLive } from "#modules/automations/routes";
import { CollectionsRoutesLive } from "#modules/collections/routes";
import { DefinitionsRoutesLive } from "#modules/definitions/routes";
import { EntitiesRoutesLive } from "#modules/entities/routes";
import { InterestRoutesLive } from "#modules/entity-interest/routes";
import { EventsRoutesLive } from "#modules/events/routes";
import { GodModeRoutesLive } from "#modules/god-mode/routes";
import { ImportsRoutesLive } from "#modules/imports/routes";
import { IntegrationsRoutesLive } from "#modules/integrations/routes";
import { LibraryRoutesLive } from "#modules/library-membership/routes";
import { MediaMonitoringRoutesLive } from "#modules/media-monitoring/routes";
import { MetadataLookupRoutesLive } from "#modules/metadata-lookup/routes";
import { NotificationsRoutesLive } from "#modules/notifications/routes";
import { QueryEngineRoutesLive } from "#modules/query-engine/routes";
import { RelationshipsRoutesLive } from "#modules/relationships/routes";
import { SandboxRoutesLive } from "#modules/sandbox/routes";
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

const decodeErrorsAsBadRequest: HttpApiBuilder.MiddlewareFn<BadRequest> = (httpApp) =>
	(httpApp as HttpApp.Default<HttpApiError.HttpApiDecodeError>).pipe(
		Effect.catchTag("HttpApiDecodeError", (error) =>
			Effect.fail(new BadRequest({ message: error.message })),
		),
	);

const DecodeErrorsAsBadRequestLive = HttpApiBuilder.middleware(
	AppContract,
	decodeErrorsAsBadRequest,
);

const buildWebhookForwardRequest = (request: Request, url: URL) =>
	new Request(url.toString(), request);

const ApiBaseLive = HttpApiBuilder.api(AppContract).pipe(
	Layer.provide(Layer.mergeAll(SystemRoutesLive, AutomationsRoutesLive)),
	Layer.provide(SandboxRoutesLive),
	Layer.provide(DefinitionsRoutesLive),
	Layer.provide(RelationshipsRoutesLive),
	Layer.provide(EntitiesRoutesLive),
	Layer.provide(LibraryRoutesLive),
	Layer.provide(Layer.mergeAll(UserStateRoutesLive, UserPreferencesRoutesLive)),
	Layer.provide(EventsRoutesLive),
	Layer.provide(UploadsRoutesLive),
	Layer.provide(SavedViewsRoutesLive),
	Layer.provide(CollectionsRoutesLive),
	Layer.provide(Layer.mergeAll(GodModeRoutesLive, TestSupportRoutesLive)),
	Layer.provide(ImportsRoutesLive),
	Layer.provide(Layer.mergeAll(IntegrationsRoutesLive, NotificationsRoutesLive)),
	Layer.provide(
		Layer.mergeAll(
			MetadataLookupRoutesLive,
			MediaMonitoringRoutesLive,
			QueryEngineRoutesLive,
			InterestRoutesLive,
		),
	),
	Layer.provide(AuthMiddlewareLive),
	Layer.provide(AdminMiddlewareLive),
	Layer.provide(UploadBodyLimitMiddlewareLive),
);

const ApiLive = Layer.provide(ApiBaseLive, DecodeErrorsAsBadRequestLive);

const ScalarLive = HttpApiScalar.layer({ path: "/docs" }).pipe(Layer.provide(ApiLive));

const ApiWithScalarLive = Layer.mergeAll(ApiLive, ScalarLive);

type ApiContext = LayerTypes.Layer.Context<typeof ApiWithScalarLive>;

export const ServerLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const auth = yield* AuthService;
		const config = yield* AppConfig;
		const runtime = yield* Effect.runtime();
		const fs = yield* FileSystem.FileSystem;
		const apiContext = yield* Effect.context<ApiContext>();

		const apiLayer = ApiWithScalarLive.pipe(
			Layer.provide(Layer.succeedContext(apiContext)),
			Layer.provideMerge(BunHttpServer.layerContext),
		);
		const apiRuntime = yield* Layer.toRuntime(
			Layer.mergeAll(apiLayer, HttpApiBuilder.Router.Live, HttpApiBuilder.Middleware.layer),
		);
		const httpApp = yield* HttpApiBuilder.httpApp.pipe(Effect.provide(apiRuntime));
		const handler = HttpApp.toWebHandlerRuntime(apiRuntime)(httpApp, HttpMiddleware.logger);

		const runPromise = Runtime.runPromise(runtime);
		const serveStatic = Effect.fn("serveStatic")(function* (pathname: string) {
			const path = pathname === "/" ? "./client/index.html" : `./client${pathname}`;
			const exists = yield* fs.exists(path);
			const target = exists ? path : "./client/index.html";
			const bytes = yield* fs.readFile(target);
			return new Response(bytes, { headers: { "Content-Type": mimeType(target) } });
		});

		const server = yield* BunHttpServer.make({ port: config.port });
		yield* HttpServer.serveEffect(
			HttpApp.fromWebHandler((request) => {
				const url = new URL(request.url);
				if (url.pathname.startsWith("/api/auth/")) {
					return auth.auth.handler(request);
				}
				if (url.pathname.startsWith("/_i/")) {
					url.pathname = `/webhooks/integrations/${url.pathname.slice(4)}`;
					return handler(buildWebhookForwardRequest(request, url));
				}
				if (url.pathname.startsWith("/api/")) {
					url.pathname = url.pathname.slice(4);
					return handler(new Request(url.toString(), request));
				}
				return runPromise(serveStatic(url.pathname));
			}),
		).pipe(Effect.provideService(HttpServer.HttpServer, server));

		yield* Effect.logInfo("app backend listening").pipe(
			Effect.annotateLogs({ url: HttpServer.formatAddress(server.address) }),
		);
		return yield* Effect.never;
	}),
);
