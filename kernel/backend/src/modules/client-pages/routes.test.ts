import { expect, it } from "@effect/vitest";
import {
	AdminMiddleware,
	AuthMiddleware,
	AuthUnauthorized,
} from "@ryot-app/contract/auth-middleware";
import { ClientPageArtifactsGroup } from "@ryot-app/contract/modules/client-pages/contract";
import { ClientPageArtifactGrantNotFound } from "@ryot-app/contract/modules/client-pages/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";

import { Database } from "#lib/infrastructure/db/service";
import { makeAuthMiddleware } from "#modules/auth/service";

import { ClientPageArtifactGrantService } from "./grant-service";
import { ClientPageArtifactsRoutesLive } from "./routes";

/* oxlint-disable perfectionist/sort-objects -- Fixtures keep the service and artifact file field order. */

const user = {
	id: UserId.make("artifact-test-user"),
	name: "Artifact test user",
	email: "artifact-test@example.com",
	image: null,
	preferences: { language: null, allowNsfw: false, disableIntegrations: false },
};

const ArtifactTestContract = HttpApi.make("ryot").add(ClientPageArtifactsGroup);

const makeRoutes = (reads: string[]) => {
	const files = new Map([
		[
			"index.html",
			{ contents: new TextEncoder().encode("<html>index</html>"), contentType: "text/html" },
		],
		[
			"plugins/media/module.js",
			{
				contents: new TextEncoder().encode("export const media = true;"),
				contentType: "text/javascript",
			},
		],
	]);
	const grants = ClientPageArtifactGrantService.of({
		issue: () => Effect.die(new Error("Unused artifact grant operation")),
		findFile: (_token, fileName) => {
			reads.push(fileName);
			const file = files.get(fileName);
			return file
				? Effect.succeed(file)
				: Effect.fail(
						new ClientPageArtifactGrantNotFound({ reason: { code: "artifact-grant-not-found" } }),
					);
		},
	});
	const authorization = {
		accessClass: "standard" as const,
		userId: user.id,
		credential: { clientId: "ryot-web", kind: "oauth" as const },
	};
	const auth = makeAuthMiddleware(
		{
			apiKeyUser: () => Effect.succeed({ user, authorization }),
			oauthUser: () => Effect.succeed({ user, authorization }),
		},
		{ isActive: () => Effect.succeed(false) },
	);
	const services = Layer.mergeAll(
		Layer.succeed(AuthMiddleware, auth),
		Layer.succeed(ClientPageArtifactGrantService, grants),
		Layer.succeed(Database, Database.of(Object.create(null))),
	);
	return HttpApiBuilder.layer(ArtifactTestContract).pipe(
		Layer.provide(
			Layer.mergeAll(
				ClientPageArtifactsRoutesLive,
				HttpServer.layerServices,
				Layer.succeed(AdminMiddleware, {
					adminToken: () =>
						Effect.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } })),
				}),
			),
		),
		Layer.provideMerge(services),
		HttpRouter.provideRequest(services),
	);
};

it.effect("serves nested artifact files and rejects ungranted or escaping paths", () => {
	const reads: string[] = [];
	const routes = makeRoutes(reads);
	return Effect.acquireUseRelease(
		Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
		({ handler }) =>
			Effect.gen(function* () {
				const request = (fileName: string) =>
					Effect.promise(() =>
						handler(
							new Request(
								`http://server.test/client-pages/artifacts/${"a".repeat(43)}/${fileName}`,
								{ headers: { authorization: "Bearer artifact-test" } },
							),
						),
					);

				const index = yield* request("index.html");
				expect(index.status).toBe(200);
				expect(yield* Effect.promise(() => index.text())).toBe("<html>index</html>");

				const nested = yield* request("plugins/media/module.js");
				expect(nested.status).toBe(200);
				expect(yield* Effect.promise(() => nested.text())).toBe("export const media = true;");

				const sibling = yield* request("plugins/other/module.js");
				expect(sibling.status).toBe(404);

				const escaping = yield* request("%252e%252e%252fsecret.js");
				expect(escaping.status).toBe(404);
				expect(reads).toEqual(["index.html", "plugins/media/module.js", "plugins/other/module.js"]);
			}),
		({ dispose }) => Effect.promise(dispose),
	);
});
