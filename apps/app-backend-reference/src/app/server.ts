import { FileSystem, HttpApiBuilder, HttpApiScalar, Multipart } from "@effect/platform";
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer, Option, Runtime } from "effect";

import { AppContract } from "../contract";
import { AdminMiddlewareLive, AuthMiddlewareLive, AuthService } from "../lib/auth";
import { AppConfig } from "../lib/config";
import { httpRequestCount } from "../lib/metrics";
import { AudibleRoutesLive } from "../modules/audible/routes";
import { AudibleService } from "../modules/audible/service";
import { GodModeRoutesLive } from "../modules/god-mode/routes";
import { PatternsRoutesLive } from "../modules/patterns/routes";
import { PatternsService } from "../modules/patterns/service";
import { SandboxRoutesLive } from "../modules/sandbox/routes";
import { SandboxApiService } from "../modules/sandbox/service";
import { UploadsRoutesLive } from "../modules/uploads/routes";
import { UploadsService } from "../modules/uploads/service";

const mimeType = (path: string) => {
	if (path.endsWith(".css")) {
		return "text/css; charset=utf-8";
	}
	if (path.endsWith(".js")) {
		return "application/javascript; charset=utf-8";
	}
	return "text/html; charset=utf-8";
};

const ApiLive = HttpApiBuilder.api(AppContract).pipe(
	Layer.provide(AudibleRoutesLive),
	Layer.provide(GodModeRoutesLive),
	Layer.provide(SandboxRoutesLive),
	Layer.provide(PatternsRoutesLive),
	Layer.provide(UploadsRoutesLive),
	Layer.provide(AdminMiddlewareLive),
	Layer.provide(AuthMiddlewareLive),
);

const ScalarLive = Layer.provide(HttpApiScalar.layer({ path: "/docs" }), ApiLive);

const ApiWithScalarLive = Layer.mergeAll(ApiLive, ScalarLive);

export const ServerLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const auth = yield* AuthService;
		const audible = yield* AudibleService;
		const config = yield* AppConfig;
		const fs = yield* FileSystem.FileSystem;
		const runtime = yield* Effect.runtime();
		const uploads = yield* UploadsService;
		const sandbox = yield* SandboxApiService;
		const patterns = yield* PatternsService;

		const apiLayer = ApiWithScalarLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(AppConfig, config),
					Layer.succeed(AuthService, auth),
					Layer.succeed(AudibleService, audible),
					Layer.succeed(UploadsService, uploads),
					Layer.succeed(SandboxApiService, sandbox),
					Layer.succeed(PatternsService, patterns),
				),
			),
			Layer.provideMerge(BunHttpServer.layerContext),
		);

		const { dispose, handler } = HttpApiBuilder.toWebHandler(apiLayer, {
			middleware: (app) =>
				Multipart.withLimits(app, {
					maxFileSize: Option.some(10 * 1024 * 1024),
					maxTotalSize: Option.some(10 * 1024 * 1024),
				}),
		});

		const serveStatic = async (pathname: string) => {
			const path = pathname === "/" ? "./public/index.html" : `./public${pathname}`;
			const runPromise = Runtime.runPromise(runtime);
			const exists = await runPromise(fs.exists(path));
			const target = exists ? path : "./public/index.html";
			const bytes = await runPromise(fs.readFile(target));
			return new Response(bytes, { headers: { "Content-Type": mimeType(target) } });
		};

		const server = Bun.serve({
			port: config.port,
			fetch: async (request) => {
				httpRequestCount.unsafeUpdate(1, []);
				const url = new URL(request.url);
				if (url.pathname.startsWith("/api/auth/")) {
					return auth.auth.handler(request);
				}
				if (url.pathname.startsWith("/api/")) {
					url.pathname = url.pathname.slice(4);
					return handler(new Request(url.toString(), request));
				}
				return serveStatic(url.pathname);
			},
		});

		yield* Effect.logInfo(`reference backend listening on ${String(server.url)}`);
		yield* Effect.addFinalizer(() =>
			Effect.promise(async () => {
				await server.stop(true);
				await dispose();
			}).pipe(Effect.orDie),
		);
		return yield* Effect.never;
	}),
);
