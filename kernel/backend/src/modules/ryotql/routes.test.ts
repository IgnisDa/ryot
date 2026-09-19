import { expect, it } from "@effect/vitest";
import {
	AdminMiddleware,
	AuthMiddleware,
	AuthUnauthorized,
	DemoOperationProtected,
} from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
import type { AccessClass } from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import { column, field, rows, table } from "@ryot-app/ryotql";
import { Effect, Layer } from "effect";
import { HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiMiddleware, HttpApiTest } from "effect/unstable/httpapi";

import { Database } from "#lib/infrastructure/db/service";
import { makeAuthMiddleware } from "#modules/auth/service";

import { RyotQLRoutesLive } from "./routes";
import { RyotQLService } from "./service";

const user = {
	image: null,
	name: "User",
	id: UserId.make("user-1"),
	email: "user@example.com",
	preferences: { language: null, allowNsfw: false, disableIntegrations: false },
};

const client = HttpApiTest.groups(AppContract, ["ryotql"]);

const credential = (accessClass: AccessClass, kind: "oauth" | "api-key") => ({
	user,
	authorization: {
		accessClass,
		userId: user.id,
		credential:
			kind === "oauth"
				? { clientId: "ryot-web", kind: "oauth" as const }
				: { keyId: "key-1", kind: "api-key" as const },
	},
});

const makeRoutes = (credentials: string[] = []) => {
	const db = Object.assign(Object.create(null), { execute: () => Effect.succeed([]) });
	const database = Database.of(
		Object.assign(Object.create(null), {
			transaction: ((callback) => callback(db)) satisfies Database["Service"]["transaction"],
		}),
	);
	const auth = makeAuthMiddleware(
		{
			apiKeyUser: (key) => {
				credentials.push(`api-key:${key}`);
				return key === ""
					? Effect.fail(new AuthUnauthorized({ reason: { code: "authentication-required" } }))
					: Effect.succeed(credential(key === "demo" ? "demo" : "standard", "api-key"));
			},
			oauthUser: (token) => {
				credentials.push(`oauth:${token}`);
				return token === ""
					? Effect.fail(new AuthUnauthorized({ reason: { code: "authentication-required" } }))
					: Effect.succeed(credential(token === "demo" ? "demo" : "standard", "oauth"));
			},
		},
		{ isActive: () => Effect.succeed(false) },
	);
	const serviceLayer: Layer.Layer<RyotQLService> = RyotQLService.layer.pipe(
		Layer.provide(Layer.succeed(Database, database)),
	);
	return Layer.mergeAll(
		RyotQLRoutesLive,
		HttpServer.layerServices,
		Layer.succeed(AdminMiddleware, {
			adminToken: () =>
				Effect.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } })),
		}),
	).pipe(
		Layer.provideMerge(serviceLayer),
		HttpRouter.provideRequest(serviceLayer),
		Layer.provideMerge(Layer.succeed(AuthMiddleware, auth)),
	);
};

const requestCredentials = (kind: "oauth" | "api-key", accessClass: AccessClass) =>
	HttpApiMiddleware.layerClient(AuthMiddleware, ({ next, request }) =>
		next(
			kind === "oauth"
				? HttpClientRequest.bearerToken(request, accessClass)
				: HttpClientRequest.setHeader(request, "x-api-key", accessClass),
		),
	);

it.effect("returns a typed 403 for protected demo RyotQL reads over OAuth and API key", () => {
	const credentials: string[] = [];
	const backup = table("backupRun", "backup");
	const integration = table("integration", "integration");
	return Effect.gen(function* () {
		for (const kind of ["oauth", "api-key"] as const) {
			const api = yield* client.pipe(Effect.provide(requestCredentials(kind, "demo")));
			for (const document of [
				{ queries: { runs: rows(backup, { fields: [field("id", column(backup, "id"))] }) } },
				{
					queries: {
						integrations: rows(integration, {
							fields: [field("token", column(integration, "webhookToken"))],
						}),
					},
				},
			]) {
				const error = yield* Effect.flip(api.ryotql.execute({ payload: document }));
				expect(credentials.at(-1)).toBe(kind === "oauth" ? "oauth:demo" : "api-key:demo");
				expect(error).toBeInstanceOf(DemoOperationProtected);
				expect(error).toMatchObject({ reason: { code: "demo-operation-protected" } });
			}
		}
	}).pipe(Effect.provide(makeRoutes(credentials)));
});

it.effect(
	"allows safe demo reads while preserving plugin-audience denial and standard reads",
	() => {
		const backup = table("backupRun", "backup");
		const integration = table("integration", "integration");
		return Effect.gen(function* () {
			const summary = {
				queries: {
					integrations: rows(integration, { fields: [field("name", column(integration, "name"))] }),
				},
			};
			for (const accessClass of ["standard", "demo"] as const) {
				const api = yield* client.pipe(Effect.provide(requestCredentials("oauth", accessClass)));
				const result = yield* api.ryotql.execute({ payload: summary });
				expect(result.data["integrations"]).toMatchObject({ items: [], type: "rows" });
				const error = yield* Effect.flip(
					api.ryotql.executePlugin({
						payload: { queries: { runs: rows(backup, { fields: [] }) } },
					}),
				);
				expect(error).toBeInstanceOf(RyotQLBadRequest);
			}
			const standardApi = yield* client.pipe(
				Effect.provide(requestCredentials("api-key", "standard")),
			);
			const standard = yield* standardApi.ryotql.execute({
				payload: {
					queries: { runs: rows(backup, { fields: [field("id", column(backup, "id"))] }) },
				},
			});
			expect(standard.data["runs"]).toMatchObject({ items: [], type: "rows" });
		}).pipe(Effect.provide(makeRoutes()));
	},
);
