import { assert, expect, it } from "@effect/vitest";
import {
	AdminMiddleware,
	AuthMiddleware,
	AuthUnauthorized,
} from "@ryot-app/contract/auth-middleware";
import { ClientDocumentsGroup } from "@ryot-app/contract/modules/client-pages/contract";
import { ClientDocumentGrantNotFound } from "@ryot-app/contract/modules/client-pages/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";

import { Database } from "#lib/infrastructure/db/service";
import { ClientArtifactGrantService } from "#modules/client-artifacts/grant-service";
import { ClientArtifactStore } from "#modules/client-artifacts/store";

import { composeClientPage } from "./composition";
import { ClientDocumentGrantService } from "./grant-service";
import { ClientPagesRepository } from "./repository";
import { ClientDocumentsRoutesLive } from "./routes";
import { descriptions, identity } from "./test-fixtures";

const contract = HttpApi.make("ryot").add(ClientDocumentsGroup);

it.effect("serves a no-store document from a capability without HTTP authentication", () => {
	const manifest = composeClientPage({
		identity: identity(),
		artifacts: descriptions(),
		runtimeEntries: { sdk: "runtime.js", bootstrap: "bootstrap.js" },
	});
	const services = Layer.mergeAll(
		Layer.succeed(Database, Database.of(Object.create(null))),
		Layer.succeed(
			ClientDocumentGrantService,
			ClientDocumentGrantService.of({
				issue: () => Effect.die("unused"),
				resolve: (token) =>
					token === "valid"
						? Effect.succeed({ userId: UserId.make("user-1"), compositionHash: "composition" })
						: Effect.fail(
								new ClientDocumentGrantNotFound({ reason: { code: "document-grant-not-found" } }),
							),
			}),
		),
		Layer.succeed(
			ClientPagesRepository,
			ClientPagesRepository.of(
				Object.assign(Object.create(null), {
					findCompositionByHash: (hash: string) =>
						Effect.succeed(hash === "composition" ? { manifest, compositionHash: hash } : null),
				}),
			),
		),
		Layer.succeed(
			ClientArtifactStore,
			ClientArtifactStore.of({
				isPublic: () => true,
				exists: () => Effect.succeed(true),
				findFile: () => Effect.succeed(null),
				describe: (hash) => {
					const artifactDescriptions = descriptions();
					if (!artifactDescriptions.has(hash)) {
						return Effect.succeed(null);
					}
					const description = artifactDescriptions.get(hash);
					assert(description);
					return Effect.succeed({
						...description,
						hash,
						format: 1,
						apiVersion: 1,
						bridgeVersion: 1,
						compilerVersion: 1,
					});
				},
			}),
		),
		Layer.succeed(
			ClientArtifactGrantService,
			ClientArtifactGrantService.of({
				resolve: () => Effect.succeed(null),
				issue: () => Effect.die("public artifacts must not request grants"),
			}),
		),
	);
	const routes = HttpApiBuilder.layer(contract).pipe(
		Layer.provide(
			Layer.mergeAll(
				ClientDocumentsRoutesLive,
				HttpServer.layerServices,
				Layer.succeed(AdminMiddleware, {
					adminToken: () =>
						Effect.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } })),
				}),
				Layer.succeed(AuthMiddleware, Object.create(null)),
			),
		),
		Layer.provideMerge(services),
		HttpRouter.provideRequest(services),
	);
	return Effect.acquireUseRelease(
		Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
		({ handler }) =>
			Effect.gen(function* () {
				const document = yield* Effect.promise(() =>
					handler(new Request("http://server.test/client-pages/documents/valid")),
				);
				expect(document.status).toBe(200);
				expect(document.headers.get("cache-control")).toBe("private, no-store");
				expect(document.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
				expect(yield* Effect.promise(() => document.text())).toContain("/api/client-assets/");
				const invalid = yield* Effect.promise(() =>
					handler(new Request("http://server.test/client-pages/documents/expired")),
				);
				expect(invalid.status).toBe(404);
			}),
		({ dispose }) => Effect.promise(dispose),
	);
});
