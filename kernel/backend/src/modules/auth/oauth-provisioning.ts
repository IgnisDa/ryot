import {
	getOAuthIssuer,
	getOAuthResource,
	getWebOAuthLogoutRedirectUris,
	getWebOAuthRedirectUris,
	OAUTH_ACCESS_TOKEN_TTL_SECONDS,
	OAUTH_API_SCOPE,
	OAUTH_NATIVE_CALLBACK_URIS,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_NATIVE_LOGOUT_CALLBACK_URIS,
	OAUTH_REFRESH_TOKEN_TTL_SECONDS,
	OAUTH_SCOPES,
	OAUTH_WEB_CLIENT_ID,
} from "@ryot/contract/oauth";
import { Context, DateTime, Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

import {
	AuthRepository,
	type InternalOAuthClient,
	type InternalOAuthClientResource,
	type InternalOAuthResource,
} from "./repository";

const INTERNAL_OAUTH_RESOURCE_ID = "ryot-api";

export const internalOAuthRecords = (frontendOrigin: string, now: Date) => {
	const resourceIdentifier = getOAuthResource(frontendOrigin);
	const webRedirectUris = getWebOAuthRedirectUris(frontendOrigin);
	const webLogoutRedirectUris = getWebOAuthLogoutRedirectUris(frontendOrigin);
	const client = (
		clientId: typeof OAUTH_WEB_CLIENT_ID | typeof OAUTH_NATIVE_CLIENT_ID,
		applicationType: "web" | "native",
		redirectUris: readonly string[],
		postLogoutRedirectUris: readonly string[],
	): InternalOAuthClient => ({
		clientId,
		updatedAt: now,
		createdAt: now,
		applicationType,
		disabled: false,
		requirePKCE: true,
		skipConsent: true,
		clientSecret: null,
		enableEndSession: true,
		responseTypes: ["code"],
		scopes: [...OAUTH_SCOPES],
		clientCredentialsScopes: [],
		redirectUris: [...redirectUris],
		tokenEndpointAuthMethod: "none",
		id: `internal-oauth-client:${clientId}`,
		postLogoutRedirectUris: [...postLogoutRedirectUris],
		grantTypes: ["authorization_code", "refresh_token"],
	});
	const webClient = client(OAUTH_WEB_CLIENT_ID, "web", webRedirectUris, webLogoutRedirectUris);
	const nativeClient = client(
		OAUTH_NATIVE_CLIENT_ID,
		"native",
		OAUTH_NATIVE_CALLBACK_URIS,
		OAUTH_NATIVE_LOGOUT_CALLBACK_URIS,
	);
	const clients = [webClient, nativeClient] as const;
	const resource = {
		createdAt: now,
		updatedAt: now,
		disabled: false,
		name: "Ryot API",
		identifier: resourceIdentifier,
		id: INTERNAL_OAUTH_RESOURCE_ID,
		allowedScopes: [OAUTH_API_SCOPE],
		accessTokenTtl: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
		refreshTokenTtl: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
	} satisfies InternalOAuthResource;
	const links = clients.map(
		({ clientId }): InternalOAuthClientResource => ({
			clientId,
			createdAt: now,
			resourceId: resource.identifier,
			id: `internal-oauth-client-resource:${clientId}`,
		}),
	);
	return { clients, links, resource };
};

export class OAuthProvisioningService extends Context.Service<OAuthProvisioningService>()(
	"OAuthProvisioningService",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const database = yield* Database;
			const repository = yield* AuthRepository;
			const provision = Effect.fn("OAuthProvisioningService.provision")(function* () {
				const now = yield* DateTime.nowAsDate;
				const records = internalOAuthRecords(config.frontendUrl, now);
				yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							for (const client of records.clients) {
								yield* repository.upsertInternalOAuthClient(client);
							}
							yield* repository.deleteInternalOAuthClientResources(
								records.clients.map(({ clientId }) => clientId),
							);
							yield* repository.upsertInternalOAuthResource(records.resource);
							for (const link of records.links) {
								yield* repository.upsertInternalOAuthClientResource(link);
							}
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
				yield* Effect.logInfo("internal OAuth provisioning complete").pipe(
					Effect.annotateLogs({
						resource: records.resource.identifier,
						webRedirectUris: records.clients[0].redirectUris,
						issuer: getOAuthIssuer(config.frontendUrl),
						nativeRedirectUris: records.clients[1].redirectUris,
					}),
				);
			});
			return { provision };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export class InternalOAuthProvisioningComplete extends Context.Service<InternalOAuthProvisioningComplete>()(
	"InternalOAuthProvisioningComplete",
	{
		make: Effect.gen(function* () {
			const provisioning = yield* OAuthProvisioningService;
			yield* provisioning.provision();
			return { done: true as const };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
