import { expect, it } from "@effect/vitest";
import { ClientAssetsGroup } from "@ryot-app/contract/modules/client-pages/contract";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Result } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";

import { Database } from "#lib/infrastructure/db/service";

import { ClientArtifactGrantService } from "./grant-service";
import { ClientAssetsRoutesLive, serveClientAsset } from "./routes";
import { ClientArtifactStore } from "./store";
import { buildClientAssetUrl } from "./url";

const publicHash = "a".repeat(64);
const privateHash = "b".repeat(64);
const token = "x".repeat(43);
const otherToken = "y".repeat(43);

const makeServices = (reads: string[]) =>
	Layer.mergeAll(
		Layer.succeed(Database, Database.of(Object.create(null))),
		Layer.succeed(
			ClientArtifactStore,
			ClientArtifactStore.of({
				exists: () => Effect.succeed(false),
				describe: () => Effect.succeed(null),
				isPublic: (hash) => hash === publicHash,
				findFile: (hash, name) =>
					Effect.sync(() => {
						reads.push(`${hash}/${name}`);
						return name === "module.js" || name === "some module.js"
							? { contents: new Uint8Array([42]), contentType: "text/javascript" }
							: null;
					}),
			}),
		),
		Layer.succeed(
			ClientArtifactGrantService,
			ClientArtifactGrantService.of({
				issue: () => Effect.die(new Error("Unexpected issue")),
				resolve: (key) =>
					Effect.succeed(
						key === token ? { artifactHash: privateHash, userId: UserId.make("user") } : null,
					),
			}),
		),
	);

it.effect(
	"serves public and authorized files through one handler with distinct cache policy",
	() => {
		const reads: string[] = [];
		return Effect.gen(function* () {
			const publicFile = yield* serveClientAsset({
				accessKey: "public",
				fileName: "module.js",
				artifactHash: publicHash,
			});
			const privateFile = yield* serveClientAsset({
				accessKey: token,
				fileName: "module.js",
				artifactHash: privateHash,
			});
			expect(publicFile.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
			expect(privateFile.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
			expect(publicFile.headers["cross-origin-resource-policy"]).toBe("cross-origin");
			expect(reads).toEqual([`${publicHash}/module.js`, `${privateHash}/module.js`]);
			expect(buildClientAssetUrl(publicHash, "public", "nested/module.js")).toBe(
				`/api/client-assets/${publicHash}/public/nested/module.js`,
			);
			expect(buildClientAssetUrl(privateHash, token, "module.js")).toBe(
				`/api/client-assets/${privateHash}/${token}/module.js`,
			);
			expect(buildClientAssetUrl(publicHash, "public", "some module.js")).toBe(
				`/api/client-assets/${publicHash}/public/some%20module.js`,
			);
		}).pipe(Effect.provide(makeServices(reads)));
	},
);

it.effect(
	"rejects private public access, mismatched grants and encoded traversal before reading bytes",
	() => {
		const reads: string[] = [];
		return Effect.gen(function* () {
			for (const input of [
				{ accessKey: "public", fileName: "module.js", artifactHash: privateHash },
				{ accessKey: token, fileName: "module.js", artifactHash: publicHash },
				{ accessKey: otherToken, fileName: "module.js", artifactHash: privateHash },
				{ accessKey: "bad", fileName: "module.js", artifactHash: privateHash },
				{ accessKey: "public", artifactHash: publicHash, fileName: "%252e%252e%252fsecret.js" },
				{ accessKey: "public", fileName: "module.js", artifactHash: "invalid" },
			]) {
				expect(Result.isFailure(yield* Effect.result(serveClientAsset(input)))).toBe(true);
			}
			expect(reads).toEqual([]);
		}).pipe(Effect.provide(makeServices(reads)));
	},
);

it.effect("routes public and authorized requests without HTTP authentication", () => {
	const reads: string[] = [];
	const services = makeServices(reads);
	const api = HttpApi.make("ryot").add(ClientAssetsGroup);
	const route = HttpApiBuilder.layer(api).pipe(
		Layer.provide(Layer.mergeAll(ClientAssetsRoutesLive, HttpServer.layerServices)),
		Layer.provideMerge(services),
		HttpRouter.provideRequest(services),
	);
	return Effect.acquireUseRelease(
		Effect.sync(() => HttpRouter.toWebHandler(route, { disableLogger: true })),
		({ handler }) => {
			const request = (hash: string, accessKey: string, name: string) =>
				Effect.promise(() =>
					handler(new Request(`http://server.test/client-assets/${hash}/${accessKey}/${name}`)),
				);
			return Effect.gen(function* () {
				const publicFile = yield* request(publicHash, "public", "module.js");
				expect(publicFile.status).toBe(200);
				expect(publicFile.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
				expect(publicFile.headers.get("access-control-allow-origin")).toBe("*");
				const privateFile = yield* request(privateHash, token, "module.js");
				expect(privateFile.status).toBe(200);
				expect(privateFile.headers.get("cache-control")).toBe(
					"private, max-age=31536000, immutable",
				);
				expect((yield* request(privateHash, "public", "module.js")).status).toBe(404);
				expect((yield* request(publicHash, token, "module.js")).status).toBe(404);
				expect((yield* request(publicHash, "public", "%252e%252e%252fsecret.js")).status).toBe(404);
				expect((yield* request(publicHash, "public", "some%20module.js")).status).toBe(200);
				expect(reads).toEqual([
					`${publicHash}/module.js`,
					`${privateHash}/module.js`,
					`${publicHash}/some module.js`,
				]);
			});
		},
		({ dispose }) => Effect.promise(dispose),
	);
});
