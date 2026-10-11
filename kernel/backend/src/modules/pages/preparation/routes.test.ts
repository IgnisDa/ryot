import { expect, layer } from "@effect/vitest";
import {
	AdminMiddleware,
	AuthMiddleware,
	AuthUnauthorized,
} from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import {
	type ClientCompositionDocument,
	ClientPageDocumentStale,
	type PreparedClientPage,
} from "@ryot-app/contract/modules/pages/schemas";
import { PluginPackageId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { HttpClientRequest, HttpRouter, HttpServer } from "effect/http";
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api";

import { makeAuthMiddleware } from "#modules/accounts/auth/service";

import { PagesRoutesLive } from "./routes";
import { PagesService } from "./service";

const user = {
	image: null,
	name: "User",
	id: UserId.make("user-1"),
	email: "user@example.com",
	preferences: { language: null, disableIntegrations: false },
	accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
};

const identity = (compositionHash: string): PreparedClientPage["identity"] => ({
	compositionHash,
	contributors: [],
	exportName: "main",
	kind: "plugin-page",
	operationTargets: [],
	contentHash: "source",
	pluginId: "plugin-id",
	installationId: "installation",
	compositionKey: "composition-key",
	target: {
		path: "/",
		search: "",
		kind: "plugin-route",
		packageId: PluginPackageId.make("test/page"),
	},
});

const document: ClientCompositionDocument = {
	preloads: [],
	title: "Page",
	stylesheets: [],
	modulepreloads: [],
	importMap: { imports: {} },
	bootstrap: `/api/page-bundles/${"a".repeat(64)}/public/bootstrap.js`,
	metadata: { format: 1, apiVersion: 1, hash: "current", bridgeVersion: 1, compilerVersion: 1 },
	descriptor: {
		application: "page",
		automaticRegistry: [],
		entry: { binding: "default", specifier: "@ryot-app/kernel-renderers/fixture" },
	},
};

const client = HttpApiTest.groups(AppContract, ["pages"]);

class RouteCredentials extends Context.Service<
	RouteCredentials,
	{
		readonly requests: Effect.Effect<ReadonlyArray<string>>;
		readonly sendToken: (token: string) => Effect.Effect<void>;
	}
>()("test/RouteCredentials") {}

const routesLayer = Layer.unwrap(
	Effect.gen(function* () {
		const token = yield* Ref.make("user");
		const requests = yield* Ref.make<ReadonlyArray<string>>([]);
		const auth = makeAuthMiddleware(
			{
				apiKeyUser: () =>
					Effect.fail(new AuthUnauthorized({ reason: { code: "authentication-required" } })),
				oauthUser: (sent) =>
					sent === ""
						? Effect.fail(new AuthUnauthorized({ reason: { code: "authentication-required" } }))
						: Effect.succeed({
								user,
								authorization: {
									userId: user.id,
									accessClass: "standard" as const,
									credential: { clientId: "ryot-web", kind: "oauth" as const },
								},
							}),
			},
			{ isActive: () => Effect.succeed(false) },
		);
		const serviceLayer = Layer.succeed(
			PagesService,
			PagesService.of({
				prepare: () => Effect.die("unused"),
				isIdentityCurrent: () => Effect.die("unused"),
				document: (current, requested) =>
					Ref.update(requests, (all) => [
						...all,
						`${current.id}:${requested.compositionHash}`,
					]).pipe(
						Effect.andThen(
							requested.compositionHash === "current"
								? Effect.succeed(document)
								: Effect.fail(
										new ClientPageDocumentStale({ reason: { code: "client-page-document-stale" } }),
									),
						),
					),
			}),
		);
		return Layer.mergeAll(
			PagesRoutesLive,
			HttpServer.layerServices,
			Layer.succeed(AdminMiddleware, {
				adminToken: () =>
					Effect.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } })),
			}),
			HttpApiMiddleware.layerClient(AuthMiddleware, ({ next, request }) =>
				Effect.flatMap(Ref.get(token), (sent) =>
					next(HttpClientRequest.bearerToken(request, sent)),
				),
			),
			Layer.succeed(RouteCredentials, {
				requests: Ref.get(requests),
				sendToken: (sent) => Ref.set(token, sent),
			}),
		).pipe(
			Layer.provideMerge(serviceLayer),
			HttpRouter.provideRequest(serviceLayer),
			Layer.provideMerge(Layer.succeed(AuthMiddleware, auth)),
		);
	}),
);

layer(routesLayer)((test) => {
	test.effect("serves the document of a current identity to its authenticated user", () =>
		Effect.gen(function* () {
			const api = yield* client;
			const credentials = yield* RouteCredentials;
			expect(yield* api.pages.document({ payload: { identity: identity("current") } })).toEqual(
				document,
			);

			const stale = yield* Effect.flip(
				api.pages.document({ payload: { identity: identity("superseded") } }),
			);
			expect(stale).toBeInstanceOf(ClientPageDocumentStale);

			yield* credentials.sendToken("");
			const unauthenticated = yield* Effect.flip(
				api.pages.document({ payload: { identity: identity("current") } }),
			);
			expect(unauthenticated).toBeInstanceOf(AuthUnauthorized);
			expect(yield* credentials.requests).toEqual(["user-1:current", "user-1:superseded"]);
		}),
	);
});
