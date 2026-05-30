import { FileSystem, HttpApiBuilder } from "@effect/platform";
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer, Runtime } from "effect";

import { AppContract } from "../contract";
import { AppConfig } from "../lib/config";
import { SystemRoutesLive } from "../modules/system/routes";

const mimeType = (path: string) => {
	if (path.endsWith(".css")) {
		return "text/css; charset=utf-8";
	}
	if (path.endsWith(".js")) {
		return "application/javascript; charset=utf-8";
	}
	return "text/html; charset=utf-8";
};

const ApiLive = HttpApiBuilder.api(AppContract).pipe(Layer.provide(SystemRoutesLive));

export const ServerLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const fs = yield* FileSystem.FileSystem;
		const runtime = yield* Effect.runtime();

		const apiLayer = ApiLive.pipe(
			Layer.provide(Layer.succeed(AppConfig, config)),
			Layer.provideMerge(BunHttpServer.layerContext),
		);

		const { dispose, handler } = HttpApiBuilder.toWebHandler(apiLayer);

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
			fetch: async (request) => {
				const url = new URL(request.url);
				if (url.pathname.startsWith("/api/auth/")) {
					return new Response(null, { status: 501 });
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
			Effect.promise(async () => {
				await server.stop(true);
				await dispose();
			}).pipe(Effect.orDie),
		);
		return yield* Effect.never;
	}),
);
