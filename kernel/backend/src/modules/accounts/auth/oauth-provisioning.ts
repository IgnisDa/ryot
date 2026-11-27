import {
	getOAuthIssuer,
	getWebOAuthLogoutRedirectUris,
	getWebOAuthRedirectUris,
	OAUTH_DEMO_WEB_CLIENT_ID,
	OAUTH_IMPERSONATION_NATIVE_CLIENT_ID,
	OAUTH_IMPERSONATION_WEB_CLIENT_ID,
	OAUTH_NATIVE_CALLBACK_URIS,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_NATIVE_LOGOUT_CALLBACK_URIS,
	OAUTH_WEB_CLIENT_ID,
} from "@ryot-app/contract/oauth";
import { Context, DateTime, Effect, Layer, Option } from "effect";

import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";

import { oauthPolicy, oauthResourcePolicies } from "./oauth-policy";
import {
	AuthRepository,
	type InternalOAuthClient,
	type InternalOAuthClientResource,
	type InternalOAuthResource,
} from "./repository";

const INTERNAL_OAUTH_RESOURCE_ID = "ryot-api";

export const allowFrontendHttpRedirectUri = (frontendOrigin: string) => (url: URL) =>
	url.origin === frontendOrigin;

export const internalOAuthRecords = (frontendOrigin: string, now: Date, demoEnabled: boolean) => {
	const resources = oauthResourcePolicies(frontendOrigin);
	const webRedirectUris = getWebOAuthRedirectUris(frontendOrigin);
	const webLogoutRedirectUris = getWebOAuthLogoutRedirectUris(frontendOrigin);
	const client = (
		clientId:
			| typeof OAUTH_WEB_CLIENT_ID
			| typeof OAUTH_NATIVE_CLIENT_ID
			| typeof OAUTH_DEMO_WEB_CLIENT_ID
			| typeof OAUTH_IMPERSONATION_WEB_CLIENT_ID
			| typeof OAUTH_IMPERSONATION_NATIVE_CLIENT_ID,
		applicationType: "web" | "native",
		redirectUris: readonly string[],
		postLogoutRedirectUris: readonly string[],
		disabled = false,
	): InternalOAuthClient => ({
		clientId,
		disabled,
		updatedAt: now,
		createdAt: now,
		applicationType,
		requirePKCE: true,
		skipConsent: true,
		clientSecret: null,
		enableEndSession: true,
		responseTypes: ["code"],
		clientCredentialsScopes: [],
		redirectUris: [...redirectUris],
		tokenEndpointAuthMethod: "none",
		id: `internal-oauth-client:${clientId}`,
		scopes: [...oauthPolicy.firstPartyScopes],
		postLogoutRedirectUris: [...postLogoutRedirectUris],
		grantTypes: ["authorization_code", "refresh_token"],
	});
	const webClient = client(OAUTH_WEB_CLIENT_ID, "web", webRedirectUris, webLogoutRedirectUris);
	const demoWebClient = client(
		OAUTH_DEMO_WEB_CLIENT_ID,
		"web",
		webRedirectUris,
		webLogoutRedirectUris,
		!demoEnabled,
	);
	const nativeClient = client(
		OAUTH_NATIVE_CLIENT_ID,
		"native",
		OAUTH_NATIVE_CALLBACK_URIS,
		OAUTH_NATIVE_LOGOUT_CALLBACK_URIS,
	);
	const impersonationWebClient = client(
		OAUTH_IMPERSONATION_WEB_CLIENT_ID,
		"web",
		webRedirectUris,
		webLogoutRedirectUris,
	);
	const impersonationNativeClient = client(
		OAUTH_IMPERSONATION_NATIVE_CLIENT_ID,
		"native",
		OAUTH_NATIVE_CALLBACK_URIS,
		OAUTH_NATIVE_LOGOUT_CALLBACK_URIS,
	);
	const clients = [
		webClient,
		nativeClient,
		demoWebClient,
		impersonationWebClient,
		impersonationNativeClient,
	] as const;
	const resource = {
		createdAt: now,
		updatedAt: now,
		disabled: false,
		name: "Ryot API",
		id: INTERNAL_OAUTH_RESOURCE_ID,
		...resources.api,
	} satisfies InternalOAuthResource;
	const links = clients.map(({ clientId }): InternalOAuthClientResource => ({
		clientId,
		createdAt: now,
		resourceId: resource.identifier,
		id: `internal-oauth-client-resource:${clientId}`,
	}));
	const mcpResource = {
		...resource,
		id: "ryot-mcp",
		name: "Ryot MCP",
		...resources.mcp,
	} satisfies InternalOAuthResource;
	return { links, clients, resource, mcpResource };
};

export class OAuthProvisioningService extends Context.Service<OAuthProvisioningService>()(
	"@ryot-app/kernel-backend/modules/accounts/auth/oauth-provisioning/OAuthProvisioningService",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const database = yield* DatabaseSession;
			const repository = yield* AuthRepository;
			const provision = Effect.fn("OAuthProvisioningService.provision")(function* () {
				const now = yield* DateTime.nowAsDate;
				const records = internalOAuthRecords(
					config.frontendUrl,
					now,
					Option.isSome(config.users.demoAccountId),
				);
				yield* database.transaction(
					Effect.gen(function* () {
						for (const client of records.clients) {
							yield* repository.upsertInternalOAuthClient(client);
						}
						yield* repository.deleteInternalOAuthClientResources(
							records.clients.map(({ clientId }) => clientId),
						);
						yield* repository.upsertInternalOAuthResource(records.resource);
						yield* repository.upsertInternalOAuthResource(records.mcpResource);
						for (const link of records.links) {
							yield* repository.upsertInternalOAuthClientResource(link);
						}
					}),
				);
				yield* Effect.logInfo("internal OAuth provisioning complete").pipe(
					Effect.annotateLogs({
						resource: records.resource.identifier,
						issuer: getOAuthIssuer(config.frontendUrl),
						webRedirectUris: records.clients[0].redirectUris,
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
	"@ryot-app/kernel-backend/modules/accounts/auth/oauth-provisioning/InternalOAuthProvisioningComplete",
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
