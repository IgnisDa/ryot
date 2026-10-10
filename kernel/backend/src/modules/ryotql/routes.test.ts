import { expect, layer } from "@effect/vitest";
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
import { Context, Effect, Layer, Ref } from "effect";
import { HttpClientRequest, HttpRouter, HttpServer } from "effect/http";
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api";

import { mapDatabaseErrors } from "#lib/infrastructure/db/errors";
import { fakeDatabaseSession } from "#lib/test-utils/effect";
import { makeAuthMiddleware } from "#modules/auth/service";

import { RyotQLRoutesLive } from "./routes";
import { RyotQLService } from "./service";

const user = {
	image: null,
	name: "User",
	id: UserId.make("user-1"),
	email: "user@example.com",
	preferences: { language: null, disableIntegrations: false },
	accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
};

type CredentialKind = "oauth" | "api-key";

const client = HttpApiTest.groups(AppContract, ["ryotql"]);

const credential = (accessClass: AccessClass, kind: CredentialKind) => ({
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

class RouteCredentials extends Context.Service<
	RouteCredentials,
	{
		readonly authenticated: Effect.Effect<ReadonlyArray<string>>;
		readonly sendAs: (kind: CredentialKind, accessClass: AccessClass) => Effect.Effect<void>;
	}
>()("test/RouteCredentials") {}

const routesLayer = Layer.unwrap(
	Effect.gen(function* () {
		const authenticated = yield* Ref.make<ReadonlyArray<string>>([]);
		const sent = yield* Ref.make<{ kind: CredentialKind; accessClass: AccessClass }>({
			kind: "oauth",
			accessClass: "standard",
		});
		const record = (entry: string) => Ref.update(authenticated, (all) => [...all, entry]);
		const db = Object.assign(Object.create(null), { execute: () => Effect.succeed([]) });
		const database = fakeDatabaseSession(db, { transaction: (work) => mapDatabaseErrors(work) });
		const auth = makeAuthMiddleware(
			{
				apiKeyUser: (key) =>
					record(`api-key:${key}`).pipe(
						Effect.andThen(
							key === ""
								? Effect.fail(new AuthUnauthorized({ reason: { code: "authentication-required" } }))
								: Effect.succeed(credential(key === "demo" ? "demo" : "standard", "api-key")),
						),
					),
				oauthUser: (token) =>
					record(`oauth:${token}`).pipe(
						Effect.andThen(
							token === ""
								? Effect.fail(new AuthUnauthorized({ reason: { code: "authentication-required" } }))
								: Effect.succeed(credential(token === "demo" ? "demo" : "standard", "oauth")),
						),
					),
			},
			{ isActive: () => Effect.succeed(false) },
		);
		const serviceLayer: Layer.Layer<RyotQLService> = RyotQLService.layer.pipe(
			Layer.provide(database),
		);
		return Layer.mergeAll(
			RyotQLRoutesLive,
			HttpServer.layerServices,
			Layer.succeed(AdminMiddleware, {
				adminToken: () =>
					Effect.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } })),
			}),
			HttpApiMiddleware.layerClient(AuthMiddleware, ({ next, request }) =>
				Effect.flatMap(Ref.get(sent), ({ kind, accessClass }) =>
					next(
						kind === "oauth"
							? HttpClientRequest.bearerToken(request, accessClass)
							: HttpClientRequest.setHeader(request, "x-api-key", accessClass),
					),
				),
			),
			Layer.succeed(RouteCredentials, {
				authenticated: Ref.get(authenticated),
				sendAs: (kind, accessClass) => Ref.set(sent, { kind, accessClass }),
			}),
		).pipe(
			Layer.provideMerge(serviceLayer),
			HttpRouter.provideRequest(serviceLayer),
			Layer.provideMerge(Layer.succeed(AuthMiddleware, auth)),
		);
	}),
);

layer(routesLayer)((test) => {
	test.effect("returns a typed 403 for protected demo RyotQL reads over OAuth and API key", () => {
		const backup = table("backupRun", "backup");
		const integration = table("integration", "integration");
		return Effect.gen(function* () {
			const credentials = yield* RouteCredentials;
			for (const kind of ["oauth", "api-key"] as const) {
				yield* credentials.sendAs(kind, "demo");
				const api = yield* client;
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
					expect((yield* credentials.authenticated).at(-1)).toBe(
						kind === "oauth" ? "oauth:demo" : "api-key:demo",
					);
					expect(error).toBeInstanceOf(DemoOperationProtected);
					expect(error).toMatchObject({ reason: { code: "demo-operation-protected" } });
				}
			}
		});
	});
});

layer(routesLayer)((test) => {
	test.effect(
		"allows safe demo reads while preserving plugin-audience denial and standard reads",
		() => {
			const backup = table("backupRun", "backup");
			const integration = table("integration", "integration");
			return Effect.gen(function* () {
				const credentials = yield* RouteCredentials;
				const summary = {
					queries: {
						integrations: rows(integration, {
							fields: [field("name", column(integration, "name"))],
						}),
					},
				};
				for (const accessClass of ["standard", "demo"] as const) {
					yield* credentials.sendAs("oauth", accessClass);
					const api = yield* client;
					const result = yield* api.ryotql.execute({ payload: summary });
					expect(result.data["integrations"]).toMatchObject({ items: [], type: "rows" });
					const error = yield* Effect.flip(
						api.ryotql.executePlugin({
							payload: { queries: { runs: rows(backup, { fields: [] }) } },
						}),
					);
					expect(error).toBeInstanceOf(RyotQLBadRequest);
				}
				yield* credentials.sendAs("api-key", "standard");
				const standardApi = yield* client;
				const standard = yield* standardApi.ryotql.execute({
					payload: {
						queries: { runs: rows(backup, { fields: [field("id", column(backup, "id"))] }) },
					},
				});
				expect(standard.data["runs"]).toMatchObject({ items: [], type: "rows" });
			});
		},
	);
});
