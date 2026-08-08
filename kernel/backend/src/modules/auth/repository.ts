import type { UserId } from "@ryot/contract/schema/brands";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

export type PortableUserProfile = Pick<
	typeof schema.user.$inferSelect,
	"image" | "name" | "preferences"
>;

export type InternalOAuthClient = Pick<
	typeof schema.oauthClient.$inferInsert,
	| "id"
	| "scopes"
	| "clientId"
	| "disabled"
	| "grantTypes"
	| "createdAt"
	| "updatedAt"
	| "redirectUris"
	| "requirePKCE"
	| "skipConsent"
	| "clientSecret"
	| "responseTypes"
	| "applicationType"
	| "enableEndSession"
	| "postLogoutRedirectUris"
	| "tokenEndpointAuthMethod"
	| "clientCredentialsScopes"
>;

export type InternalOAuthResource = Pick<
	typeof schema.oauthResource.$inferInsert,
	| "id"
	| "name"
	| "disabled"
	| "createdAt"
	| "updatedAt"
	| "identifier"
	| "allowedScopes"
	| "accessTokenTtl"
	| "refreshTokenTtl"
>;

export type InternalOAuthClientResource = Pick<
	typeof schema.oauthClientResource.$inferInsert,
	"id" | "clientId" | "createdAt" | "resourceId"
>;

export class AuthRepository extends Context.Service<AuthRepository>()("AuthRepository", {
	make: Effect.sync(() => {
		const upsertInternalOAuthClient = Effect.fn("AuthRepository.upsertInternalOAuthClient")(
			function* (client: InternalOAuthClient) {
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db
						.insert(schema.oauthClient)
						.values(client)
						.onConflictDoUpdate({
							target: schema.oauthClient.clientId,
							set: {
								scopes: client.scopes,
								disabled: client.disabled,
								updatedAt: client.updatedAt,
								grantTypes: client.grantTypes,
								requirePKCE: client.requirePKCE,
								skipConsent: client.skipConsent,
								redirectUris: client.redirectUris,
								clientSecret: client.clientSecret,
								responseTypes: client.responseTypes,
								applicationType: client.applicationType,
								enableEndSession: client.enableEndSession,
								postLogoutRedirectUris: client.postLogoutRedirectUris,
								tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
								clientCredentialsScopes: client.clientCredentialsScopes,
							},
						}),
				);
			},
		);

		const upsertInternalOAuthResource = Effect.fn("AuthRepository.upsertInternalOAuthResource")(
			function* (resource: InternalOAuthResource) {
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db
						.insert(schema.oauthResource)
						.values(resource)
						.onConflictDoUpdate({
							target: schema.oauthResource.id,
							set: {
								name: resource.name,
								disabled: resource.disabled,
								updatedAt: resource.updatedAt,
								identifier: resource.identifier,
								allowedScopes: resource.allowedScopes,
								accessTokenTtl: resource.accessTokenTtl,
								refreshTokenTtl: resource.refreshTokenTtl,
							},
						}),
				);
			},
		);

		const upsertInternalOAuthClientResource = Effect.fn(
			"AuthRepository.upsertInternalOAuthClientResource",
		)(function* (link: InternalOAuthClientResource) {
			const db = yield* Database;
			yield* mapDatabaseErrors(
				db
					.insert(schema.oauthClientResource)
					.values(link)
					.onConflictDoUpdate({
						set: { id: link.id },
						target: [schema.oauthClientResource.clientId, schema.oauthClientResource.resourceId],
					}),
			);
		});

		const deleteInternalOAuthClientResources = Effect.fn(
			"AuthRepository.deleteInternalOAuthClientResources",
		)(function* (clientIds: readonly string[]) {
			const db = yield* Database;
			yield* mapDatabaseErrors(
				db
					.delete(schema.oauthClientResource)
					.where(inArray(schema.oauthClientResource.clientId, [...clientIds])),
			);
		});

		const getPortableProfile = Effect.fn("AuthRepository.getPortableProfile")(function* (
			userId: UserId,
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({
						name: schema.user.name,
						image: schema.user.image,
						preferences: schema.user.preferences,
					})
					.from(schema.user)
					.where(eq(schema.user.id, userId))
					.limit(1),
			);
			return row ?? null;
		});

		const restorePortableProfile = Effect.fn("AuthRepository.restorePortableProfile")(function* (
			userId: UserId,
			profile: PortableUserProfile,
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.update(schema.user)
					.set(profile)
					.where(eq(schema.user.id, userId))
					.returning({ id: schema.user.id }),
			);
			return row !== undefined;
		});
		const revokeUserOAuthTokens = Effect.fn("AuthRepository.revokeUserOAuthTokens")(function* (
			userId: UserId,
		) {
			const db = yield* Database;
			const revoked = yield* DateTime.nowAsDate;
			yield* mapDatabaseErrors(
				Effect.all(
					[
						db
							.update(schema.oauthRefreshToken)
							.set({ revoked })
							.where(
								and(
									eq(schema.oauthRefreshToken.userId, userId),
									isNull(schema.oauthRefreshToken.revoked),
								),
							),
						db
							.update(schema.oauthAccessToken)
							.set({ revoked })
							.where(
								and(
									eq(schema.oauthAccessToken.userId, userId),
									isNull(schema.oauthAccessToken.revoked),
								),
							),
					],
					{ discard: true },
				),
			);
		});

		return {
			getPortableProfile,
			revokeUserOAuthTokens,
			restorePortableProfile,
			upsertInternalOAuthClient,
			upsertInternalOAuthResource,
			upsertInternalOAuthClientResource,
			deleteInternalOAuthClientResources,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
