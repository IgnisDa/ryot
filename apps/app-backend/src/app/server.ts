import { FileSystem, HttpApiBuilder, HttpApiScalar } from "@effect/platform";
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer, Runtime } from "effect";

import { AdminMiddlewareLive, AuthMiddlewareLive, AuthService } from "../lib/auth";
import { AppConfig } from "../lib/config";
import { AppContract } from "../lib/contract";
import { CollectionsRoutesLive } from "../modules/collections/routes";
import { EntitiesRoutesLive } from "../modules/entities/routes";
import { EntitySchemasRoutesLive } from "../modules/entity-schemas/routes";
import { EventSchemasRoutesLive } from "../modules/event-schemas/routes";
import { EventsRoutesLive } from "../modules/events/routes";
import { GodModeRoutesLive } from "../modules/god-mode/routes";
import { ImportsRoutesLive } from "../modules/imports/routes";
import { IntegrationsRoutesLive } from "../modules/integrations/routes";
import { QueryEngineRoutesLive } from "../modules/query-engine/routes";
import { SandboxRoutesLive } from "../modules/sandbox/routes";
import { SavedViewsRoutesLive } from "../modules/saved-views/routes";
import { SystemRoutesLive } from "../modules/system/routes";
import { TrackersRoutesLive } from "../modules/trackers/routes";
import { TrackersService } from "../modules/trackers/service";
import { UploadsRoutesLive } from "../modules/uploads/routes";

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

const ApiLive = HttpApiBuilder.api(AppContract).pipe(
	Layer.provide(SystemRoutesLive),
	Layer.provide(SandboxRoutesLive),
	Layer.provide(TrackersRoutesLive),
	Layer.provide(EntitySchemasRoutesLive),
	Layer.provide(EntitiesRoutesLive),
	Layer.provide(EventSchemasRoutesLive),
	Layer.provide(EventsRoutesLive),
	Layer.provide(UploadsRoutesLive),
	Layer.provide(SavedViewsRoutesLive),
	Layer.provide(CollectionsRoutesLive),
	Layer.provide(GodModeRoutesLive),
	Layer.provide(ImportsRoutesLive),
	Layer.provide(IntegrationsRoutesLive),
	Layer.provide(QueryEngineRoutesLive),
	Layer.provide(AuthMiddlewareLive),
	Layer.provide(AdminMiddlewareLive),
);

const ScalarLive = Layer.provide(HttpApiScalar.layer({ path: "/docs" }), ApiLive);

const ApiWithScalarLive = Layer.mergeAll(ApiLive, ScalarLive);

export const ServerLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const auth = yield* AuthService;
		const config = yield* AppConfig;
		const fs = yield* FileSystem.FileSystem;
		const runtime = yield* Effect.runtime();
		const trackers = yield* TrackersService;

		const apiLayer = ApiWithScalarLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(AppConfig, config),
					Layer.succeed(AuthService, auth),
					Layer.succeed(TrackersService, trackers),
				),
			),
			Layer.provideMerge(BunHttpServer.layerContext),
		);

		const { dispose, handler } = HttpApiBuilder.toWebHandler(apiLayer);

		// @effect-diagnostics-next-line asyncFunction:off
		const serveStatic = async (pathname: string) => {
			const path = pathname === "/" ? "./client/index.html" : `./client${pathname}`;
			const runPromise = Runtime.runPromise(runtime);
			const exists = await runPromise(fs.exists(path));
			const target = exists ? path : "./client/index.html";
			const bytes = await runPromise(fs.readFile(target));
			return new Response(bytes, { headers: { "Content-Type": mimeType(target) } });
		};

		const server = Bun.serve({
			port: config.port,
			// @effect-diagnostics-next-line asyncFunction:off
			fetch: async (request) => {
				const url = new URL(request.url);
				if (url.pathname.startsWith("/api/auth/")) {
					return auth.auth.handler(request);
				}
				if (url.pathname.startsWith("/_i/")) {
					return new Response(null, { status: 501 });
				}
				if (url.pathname.startsWith("/api/")) {
					url.pathname = url.pathname.slice(4);
					return handler(new Request(url.toString(), request));
				}
				return serveStatic(url.pathname);
			},
		});

		yield* Effect.logInfo(`app backend listening on ${String(server.url)}`);
		yield* Effect.addFinalizer(() =>
			// @effect-diagnostics-next-line asyncFunction:off
			Effect.promise(async () => {
				await server.stop(true);
				await dispose();
			}).pipe(Effect.orDie),
		);
		return yield* Effect.never;
	}),
);
