import { DbError } from "@ryot-app/contract/errors";
import type { UserId } from "@ryot-app/contract/schema/brands";
import {
	UserPreferences,
	type UserPreferencesPatch,
} from "@ryot-app/contract/schema/user-preferences";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";

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
	make: Effect.gen(function* () {
		const database = yield* DatabaseSession;
		const getUserPreferences = Effect.fn("AuthRepository.getUserPreferences")(function* (
			userId: UserId,
		) {
			const [row] = yield* database.run((db) =>
				db
					.select({ preferences: schema.user.preferences })
					.from(schema.user)
					.where(eq(schema.user.id, userId))
					.limit(1),
			);
			return row
				? yield* Schema.decodeEffect(UserPreferences)(row.preferences).pipe(
						Effect.mapError(
							(error) =>
								new DbError({ message: `Invalid stored user preferences: ${error.message}` }),
						),
					)
				: null;
		});
		const upsertInternalOAuthClient = Effect.fn("AuthRepository.upsertInternalOAuthClient")(
			function* (client: InternalOAuthClient) {
				yield* database.run((db) =>
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
				yield* database.run((db) =>
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
			yield* database.run((db) =>
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
			yield* database.run((db) =>
				db
					.delete(schema.oauthClientResource)
					.where(inArray(schema.oauthClientResource.clientId, [...clientIds])),
			);
		});

		const getPortableProfile = Effect.fn("AuthRepository.getPortableProfile")(function* (
			userId: UserId,
		) {
			const [row] = yield* database.run((db) =>
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
			return row
				? {
						...row,
						preferences: yield* Schema.decodeEffect(UserPreferences)(row.preferences).pipe(
							Effect.mapError(
								(error) =>
									new DbError({ message: `Invalid stored user preferences: ${error.message}` }),
							),
						),
					}
				: null;
		});
		const patchUserPreferences = Effect.fn("AuthRepository.patchUserPreferences")(function* (
			userId: UserId,
			patch: UserPreferencesPatch,
		) {
			const [row] = yield* database.run((db) =>
				Object.keys(patch).length === 0
					? db
							.select({ preferences: schema.user.preferences })
							.from(schema.user)
							.where(eq(schema.user.id, userId))
							.limit(1)
					: db
							.update(schema.user)
							.set({
								updatedAt: sql`CURRENT_TIMESTAMP`,
								preferences: sql`${schema.user.preferences} || ${JSON.stringify(patch)}::jsonb`,
							})
							.where(eq(schema.user.id, userId))
							.returning({ preferences: schema.user.preferences }),
			);
			if (!row) {
				return yield* new DbError({ message: "User not found while patching preferences" });
			}
			return yield* Schema.decodeEffect(UserPreferences)(row.preferences).pipe(
				Effect.mapError(
					(error) => new DbError({ message: `Invalid stored user preferences: ${error.message}` }),
				),
			);
		});

		const revokeUserOAuthTokens = Effect.fn("AuthRepository.revokeUserOAuthTokens")(function* (
			userId: UserId,
		) {
			const revoked = yield* DateTime.nowAsDate;
			yield* database.run((db) =>
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
			getUserPreferences,
			getPortableProfile,
			patchUserPreferences,
			revokeUserOAuthTokens,
			upsertInternalOAuthClient,
			upsertInternalOAuthResource,
			upsertInternalOAuthClientResource,
			deleteInternalOAuthClientResources,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
