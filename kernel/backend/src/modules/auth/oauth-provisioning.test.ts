import { expect, it } from "@effect/vitest";
import {
	OAUTH_NATIVE_CALLBACK_URIS,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_NATIVE_LOGOUT_CALLBACK_URIS,
	OAUTH_SCOPES,
	OAUTH_WEB_CLIENT_ID,
} from "@ryot/contract/oauth";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { internalOAuthRecords, OAuthProvisioningService } from "./oauth-provisioning";
import {
	AuthRepository,
	type InternalOAuthClient,
	type InternalOAuthClientResource,
	type InternalOAuthResource,
} from "./repository";

const now = new Date("2026-08-31T12:00:00.000Z");

it("builds the exact first-party clients and API resource", () => {
	const records = internalOAuthRecords("https://ryot.example", now);
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
	]);
	expect(records.resource).toEqual({
		id: "ryot-api",
		createdAt: now,
		updatedAt: now,
		disabled: false,
		name: "Ryot API",
		accessTokenTtl: 900,
		refreshTokenTtl: 2_592_000,
		allowedScopes: ["ryot:api"],
		identifier: "https://ryot.example/api",
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
	]);
});

it.effect("reprovisions the same records and updates origin-owned values", () => {
	const clients = new Map<string, InternalOAuthClient>();
	const resources = new Map<string, InternalOAuthResource>();
	const links = new Map<string, InternalOAuthClientResource>();
	const repository = AuthRepository.of({
		getPortableProfile: () => Effect.die("unused"),
		restorePortableProfile: () => Effect.die("unused"),
		upsertInternalOAuthClient: (client) => Effect.sync(() => clients.set(client.clientId, client)),
		upsertInternalOAuthResource: (resource) =>
			Effect.sync(() => resources.set(resource.id, resource)),
		deleteInternalOAuthClientResources: (clientIds) =>
			Effect.sync(() => {
				for (const [key, link] of links) {
					if (clientIds.includes(link.clientId)) {
						links.delete(key);
					}
				}
			}),
		upsertInternalOAuthClientResource: (link) =>
			Effect.sync(() => links.set(`${link.clientId}:${link.resourceId}`, link)),
	});
	const database = Database.of(
		Object.assign(Object.create(null), {
			transaction: ((run) => run(Object.create(null))) satisfies Database["Service"]["transaction"],
		}),
	);
	const provision = (frontendUrl: string) =>
		Effect.gen(function* () {
			const service = yield* OAuthProvisioningService;
			yield* service.provision();
		}).pipe(
			Effect.provide(
				OAuthProvisioningService.layer.pipe(
					Layer.provide([
						makeAppConfigLayer({ frontendUrl }),
						Layer.succeed(Database, database),
						Layer.succeed(AuthRepository, repository),
					]),
				),
			),
		);

	return Effect.gen(function* () {
		yield* provision("https://first.example");
		yield* provision("https://first.example");
		yield* provision("https://second.example");
		expect(clients).toHaveLength(2);
		expect(resources).toHaveLength(1);
		expect(links).toHaveLength(2);
		expect(clients.get(OAUTH_WEB_CLIENT_ID)?.redirectUris).toEqual([
			"https://second.example/auth/callback",
		]);
		expect(clients.get(OAUTH_NATIVE_CLIENT_ID)?.redirectUris).toEqual([
			...OAUTH_NATIVE_CALLBACK_URIS,
		]);
		expect(resources.get("ryot-api")?.identifier).toBe("https://second.example/api");
	});
});
