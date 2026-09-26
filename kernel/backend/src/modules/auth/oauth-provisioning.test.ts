import { expect, it, layer } from "@effect/vitest";
import {
	OAUTH_NATIVE_CALLBACK_URIS,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_NATIVE_LOGOUT_CALLBACK_URIS,
	OAUTH_SCOPES,
	OAUTH_DEMO_WEB_CLIENT_ID,
	OAUTH_WEB_CLIENT_ID,
} from "@ryot-app/contract/oauth";
import { Context, Effect, Layer, Option, Ref } from "effect";

import { databaseLayer, makeAppConfigLayer } from "#lib/test-utils/effect";

import { internalOAuthRecords, OAuthProvisioningService } from "./oauth-provisioning";
import {
	AuthRepository,
	type InternalOAuthClient,
	type InternalOAuthClientResource,
	type InternalOAuthResource,
} from "./repository";

const now = new Date("2026-08-31T12:00:00.000Z");

it("builds the exact first-party clients and API resource", () => {
	const records = internalOAuthRecords("https://ryot.example", now, true);
	expect(records.clients).toEqual([
		expect.objectContaining({
			disabled: false,
			requirePKCE: true,
			skipConsent: true,
			clientSecret: null,
			applicationType: "web",
			enableEndSession: true,
			responseTypes: ["code"],
			scopes: [...OAUTH_SCOPES],
			clientCredentialsScopes: [],
			clientId: OAUTH_WEB_CLIENT_ID,
			tokenEndpointAuthMethod: "none",
			grantTypes: ["authorization_code", "refresh_token"],
			redirectUris: ["https://ryot.example/auth/callback"],
			postLogoutRedirectUris: ["https://ryot.example/auth/logout/callback"],
		}),
		expect.objectContaining({
			applicationType: "native",
			clientId: OAUTH_NATIVE_CLIENT_ID,
			redirectUris: [...OAUTH_NATIVE_CALLBACK_URIS],
			postLogoutRedirectUris: [...OAUTH_NATIVE_LOGOUT_CALLBACK_URIS],
		}),
		expect.objectContaining({
			disabled: false,
			applicationType: "web",
			clientId: OAUTH_DEMO_WEB_CLIENT_ID,
			redirectUris: ["https://ryot.example/auth/callback"],
			postLogoutRedirectUris: ["https://ryot.example/auth/logout/callback"],
		}),
	]);
	expect(records.resource).toEqual({
		id: "ryot-api",
		createdAt: now,
		updatedAt: now,
		disabled: false,
		name: "Ryot API",
		accessTokenTtl: 900,
		refreshTokenTtl: 2_592_000,
		identifier: "https://ryot.example/api",
		allowedScopes: ["openid", "profile", "email", "offline_access", "ryot:api"],
	});
	expect(records.links).toEqual([
		{
			createdAt: now,
			clientId: OAUTH_WEB_CLIENT_ID,
			resourceId: "https://ryot.example/api",
			id: `internal-oauth-client-resource:${OAUTH_WEB_CLIENT_ID}`,
		},
		{
			createdAt: now,
			clientId: OAUTH_NATIVE_CLIENT_ID,
			resourceId: "https://ryot.example/api",
			id: `internal-oauth-client-resource:${OAUTH_NATIVE_CLIENT_ID}`,
		},
		{
			createdAt: now,
			clientId: OAUTH_DEMO_WEB_CLIENT_ID,
			resourceId: "https://ryot.example/api",
			id: `internal-oauth-client-resource:${OAUTH_DEMO_WEB_CLIENT_ID}`,
		},
	]);
});

it("disables the demo web client when no demo account is configured", () => {
	const records = internalOAuthRecords("https://ryot.example", now, false);
	expect(records.clients.find(({ clientId }) => clientId === OAUTH_DEMO_WEB_CLIENT_ID)).toEqual(
		expect.objectContaining({
			disabled: true,
			requirePKCE: true,
			skipConsent: true,
			clientSecret: null,
			applicationType: "web",
			grantTypes: ["authorization_code", "refresh_token"],
			redirectUris: ["https://ryot.example/auth/callback"],
			postLogoutRedirectUris: ["https://ryot.example/auth/logout/callback"],
		}),
	);
});

class FakeAuthRepository extends Context.Service<
	FakeAuthRepository,
	{
		readonly clients: Effect.Effect<ReadonlyMap<string, InternalOAuthClient>>;
		readonly resources: Effect.Effect<ReadonlyMap<string, InternalOAuthResource>>;
		readonly links: Effect.Effect<ReadonlyMap<string, InternalOAuthClientResource>>;
	}
>()("test/FakeAuthRepository") {}

const fakeAuthRepositoryLayer = Layer.effectContext(
	Effect.gen(function* () {
		const clients = yield* Ref.make<ReadonlyMap<string, InternalOAuthClient>>(new Map());
		const resources = yield* Ref.make<ReadonlyMap<string, InternalOAuthResource>>(new Map());
		const links = yield* Ref.make<ReadonlyMap<string, InternalOAuthClientResource>>(new Map());
		return Context.make(
			AuthRepository,
			AuthRepository.of({
				getPortableProfile: () => Effect.die("unused"),
				patchUserPreferences: () => Effect.die("unused"),
				revokeUserOAuthTokens: () => Effect.die("unused"),
				upsertInternalOAuthClient: (client) =>
					Ref.update(clients, (all) => new Map(all).set(client.clientId, client)),
				upsertInternalOAuthResource: (resource) =>
					Ref.update(resources, (all) => new Map(all).set(resource.id, resource)),
				upsertInternalOAuthClientResource: (link) =>
					Ref.update(links, (all) => new Map(all).set(`${link.clientId}:${link.resourceId}`, link)),
				deleteInternalOAuthClientResources: (clientIds) =>
					Ref.update(
						links,
						(all) => new Map([...all].filter(([, link]) => !clientIds.includes(link.clientId))),
					),
			}),
		).pipe(
			Context.add(FakeAuthRepository, {
				links: Ref.get(links),
				clients: Ref.get(clients),
				resources: Ref.get(resources),
			}),
		);
	}),
);

class FirstOriginProvisioning extends Context.Service<
	FirstOriginProvisioning,
	OAuthProvisioningService["Service"]
>()("test/FirstOriginProvisioning") {}

class SecondOriginProvisioning extends Context.Service<
	SecondOriginProvisioning,
	OAuthProvisioningService["Service"]
>()("test/SecondOriginProvisioning") {}

const reprovisioningLayer = Layer.mergeAll(
	Layer.effect(FirstOriginProvisioning, OAuthProvisioningService.make).pipe(
		Layer.provide(
			makeAppConfigLayer({
				frontendUrl: "https://first.example",
				users: { demoAccountId: Option.some("demo-user") },
			}),
		),
	),
	Layer.effect(SecondOriginProvisioning, OAuthProvisioningService.make).pipe(
		Layer.provide(
			makeAppConfigLayer({
				frontendUrl: "https://second.example",
				users: { demoAccountId: Option.none() },
			}),
		),
	),
).pipe(Layer.provideMerge(Layer.merge(databaseLayer, fakeAuthRepositoryLayer)));

layer(reprovisioningLayer)((test) => {
	test.effect("reprovisions the same records and updates origin-owned values", () =>
		Effect.gen(function* () {
			const repository = yield* FakeAuthRepository;
			const first = yield* FirstOriginProvisioning;
			const second = yield* SecondOriginProvisioning;
			yield* first.provision();
			expect((yield* repository.clients).get(OAUTH_DEMO_WEB_CLIENT_ID)?.disabled).toBe(false);
			yield* first.provision();
			yield* second.provision();
			const clients = yield* repository.clients;
			const resources = yield* repository.resources;
			expect(clients).toHaveLength(3);
			expect(resources).toHaveLength(1);
			expect(yield* repository.links).toHaveLength(3);
			expect(clients.get(OAUTH_WEB_CLIENT_ID)?.redirectUris).toEqual([
				"https://second.example/auth/callback",
			]);
			expect(clients.get(OAUTH_NATIVE_CLIENT_ID)?.redirectUris).toEqual([
				...OAUTH_NATIVE_CALLBACK_URIS,
			]);
			expect(clients.get(OAUTH_DEMO_WEB_CLIENT_ID)?.disabled).toBe(true);
			expect(resources.get("ryot-api")?.identifier).toBe("https://second.example/api");
		}),
	);
});
