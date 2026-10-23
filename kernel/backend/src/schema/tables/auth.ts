import {
	defaultUserPreferences,
	type UserPreferences,
} from "@ryot-app/contract/schema/user-preferences";
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	snakeCase,
	text,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { timestamptz, updatedAtColumn } from "./timestamps";

export const user = snakeCase.table(
	"user",
	{
		image: text(),
		name: text().notNull(),
		id: text().primaryKey(),
		disabledAt: timestamptz(),
		twoFactorEnabled: boolean(),
		updatedAt: updatedAtColumn(),
		email: text().notNull().unique(),
		bootstrapCompletedAt: timestamptz(),
		createdAt: timestamptz().defaultNow().notNull(),
		emailVerified: boolean().default(false).notNull(),
		accountGeneration: text()
			.default(sql`gen_random_uuid()::text`)
			.notNull(),
		preferences: jsonb().$type<UserPreferences>().default(defaultUserPreferences).notNull(),
	},
	(table) => [
		check(
			"user_preferences_check",
			sql`
		jsonb_typeof(${table.preferences}) = 'object'
		and ${table.preferences} ?& array['disableIntegrations', 'language']
		and ${table.preferences} - 'disableIntegrations' - 'language' = '{}'::jsonb
		and jsonb_typeof(${table.preferences}->'disableIntegrations') = 'boolean'
		and (
			jsonb_typeof(${table.preferences}->'language') = 'null'
			or (jsonb_typeof(${table.preferences}->'language') = 'string'
				and ${table.preferences}->>'language' <> ''
				and btrim(${table.preferences}->>'language', E' \t\n\r') = ${table.preferences}->>'language')
		)
	`,
		),
	],
);
export const session = snakeCase.table(
	"session",
	{
		ipAddress: text(),
		userAgent: text(),
		id: text().primaryKey(),
		token: text().notNull().unique(),
		expiresAt: timestamptz().notNull(),
		impersonationExpiresAt: timestamptz(),
		createdAt: timestamptz().defaultNow().notNull(),
		accessClass: text().default("standard").notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		updatedAt: timestamptz()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("session_userId_idx").on(table.userId)],
);

export const account = snakeCase.table(
	"account",
	{
		scope: text(),
		idToken: text(),
		password: text(),
		accessToken: text(),
		refreshToken: text(),
		id: text().primaryKey(),
		issuer: text().notNull(),
		accountId: text().notNull(),
		providerId: text().notNull(),
		accessTokenExpiresAt: timestamptz(),
		refreshTokenExpiresAt: timestamptz(),
		createdAt: timestamptz().defaultNow().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		updatedAt: timestamptz()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = snakeCase.table(
	"verification",
	{
		id: text().primaryKey(),
		value: text().notNull(),
		identifier: text().notNull(),
		updatedAt: updatedAtColumn(),
		expiresAt: timestamptz().notNull(),
		createdAt: timestamptz().defaultNow().notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const apikey = snakeCase.table(
	"apikey",
	{
		name: text(),
		start: text(),
		prefix: text(),
		metadata: text(),
		permissions: text(),
		remaining: integer(),
		key: text().notNull(),
		id: text().primaryKey(),
		refillAmount: integer(),
		expiresAt: timestamptz(),
		refillInterval: integer(),
		lastRequest: timestamptz(),
		lastRefillAt: timestamptz(),
		enabled: boolean().default(true),
		requestCount: integer().default(0),
		createdAt: timestamptz().notNull(),
		updatedAt: timestamptz().notNull(),
		rateLimitMax: integer().default(10),
		rateLimitEnabled: boolean().default(true),
		configId: text().default("default").notNull(),
		rateLimitTimeWindow: integer().default(86400000),
		referenceId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("apikey_configId_idx").on(table.configId),
		index("apikey_referenceId_idx").on(table.referenceId),
		index("apikey_key_idx").on(table.key),
	],
);

export const twoFactor = snakeCase.table("two_factor", {
	id: text().primaryKey(),
	secret: text().notNull(),
	lockedUntil: timestamptz(),
	verified: boolean().notNull(),
	backupCodes: text().notNull(),
	failedVerificationCount: integer().default(0),
	userId: text()
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const jwks = snakeCase.table("jwks", {
	alg: text(),
	crv: text(),
	id: text().primaryKey(),
	expiresAt: timestamptz(),
	publicKey: text().notNull(),
	privateKey: text().notNull(),
	createdAt: timestamptz().notNull(),
});

export const oauthClient = snakeCase.table(
	"oauth_client",
	{
		tos: text(),
		uri: text(),
		icon: text(),
		jwks: text(),
		name: text(),
		policy: text(),
		jwksUri: text(),
		softwareId: text(),
		referenceId: text(),
		subjectType: text(),
		clientSecret: text(),
		scopes: text().array(),
		skipConsent: boolean(),
		requirePKCE: boolean(),
		id: text().primaryKey(),
		softwareVersion: text(),
		applicationType: text(),
		contacts: text().array(),
		createdAt: timestamptz(),
		updatedAt: timestamptz(),
		clientDiscoveryId: text(),
		softwareStatement: text(),
		grantTypes: text().array(),
		enableEndSession: boolean(),
		backchannelLogoutUri: text(),
		responseTypes: text().array(),
		tokenEndpointAuthMethod: text(),
		disabled: boolean().default(false),
		clientId: text().notNull().unique(),
		redirectUris: text().array().notNull(),
		postLogoutRedirectUris: text().array(),
		backchannelLogoutSessionRequired: boolean(),
		dpopBoundAccessTokens: boolean().default(false),
		metadata: jsonb().$type<Record<string, unknown>>(),
		clientCredentialsScopes: text().array().default([]),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("oauth_client_userId_idx").on(table.userId)],
);

export const oauthResource = snakeCase.table("oauth_resource", {
	signingKeyId: text(),
	name: text().notNull(),
	id: text().primaryKey(),
	signingAlgorithm: text(),
	createdAt: timestamptz(),
	updatedAt: timestamptz(),
	accessTokenTtl: integer(),
	refreshTokenTtl: integer(),
	allowedScopes: text().array(),
	disabled: boolean().default(false),
	policyVersion: integer().default(1),
	identifier: text().notNull().unique(),
	metadata: jsonb().$type<Record<string, unknown>>(),
	customClaims: jsonb().$type<Record<string, unknown>>(),
	dpopBoundAccessTokensRequired: boolean().default(false),
});

export const oauthClientResource = snakeCase.table(
	"oauth_client_resource",
	{
		id: text().primaryKey(),
		createdAt: timestamptz(),
		metadata: jsonb().$type<Record<string, unknown>>(),
		clientId: text()
			.notNull()
			.references(() => oauthClient.clientId, { onDelete: "cascade" }),
		resourceId: text()
			.notNull()
			.references(() => oauthResource.identifier, { onDelete: "cascade" }),
	},
	(table) => [
		index("oauth_client_resource_clientId_idx").on(table.clientId),
		index("oauth_client_resource_resourceId_idx").on(table.resourceId),
		uniqueIndex("oauth_client_resource_clientId_resourceId_uidx").on(
			table.clientId,
			table.resourceId,
		),
	],
);

export const oauthRefreshToken = snakeCase.table(
	"oauth_refresh_token",
	{
		referenceId: text(),
		revoked: timestamptz(),
		id: text().primaryKey(),
		authTime: timestamptz(),
		rotatedAt: timestamptz(),
		resources: text().array(),
		authorizationCodeId: text(),
		rotationReplayResponse: text(),
		token: text().notNull().unique(),
		scopes: text().array().notNull(),
		expiresAt: timestamptz().notNull(),
		createdAt: timestamptz().notNull(),
		rotationReplayExpiresAt: timestamptz(),
		requestedUserInfoClaims: text().array(),
		confirmation: jsonb().$type<Record<string, unknown>>(),
		sessionId: text().references(() => session.id, { onDelete: "set null" }),
		clientId: text()
			.notNull()
			.references(() => oauthClient.clientId),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("oauth_refresh_token_clientId_idx").on(table.clientId),
		index("oauth_refresh_token_sessionId_idx").on(table.sessionId),
		index("oauth_refresh_token_userId_idx").on(table.userId),
		index("oauth_refresh_token_authorizationCodeId_idx").on(table.authorizationCodeId),
	],
);

export const oauthAccessToken = snakeCase.table(
	"oauth_access_token",
	{
		referenceId: text(),
		token: text().unique(),
		revoked: timestamptz(),
		id: text().primaryKey(),
		resources: text().array(),
		authorizationCodeId: text(),
		scopes: text().array().notNull(),
		expiresAt: timestamptz().notNull(),
		createdAt: timestamptz().notNull(),
		requestedUserInfoClaims: text().array(),
		confirmation: jsonb().$type<Record<string, unknown>>(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		sessionId: text().references(() => session.id, { onDelete: "set null" }),
		clientId: text()
			.notNull()
			.references(() => oauthClient.clientId),
		refreshId: text().references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("oauth_access_token_clientId_idx").on(table.clientId),
		index("oauth_access_token_sessionId_idx").on(table.sessionId),
		index("oauth_access_token_userId_idx").on(table.userId),
		index("oauth_access_token_refreshId_idx").on(table.refreshId),
		index("oauth_access_token_authorizationCodeId_idx").on(table.authorizationCodeId),
	],
);

export const oauthConsent = snakeCase.table(
	"oauth_consent",
	{
		referenceId: text(),
		id: text().primaryKey(),
		resources: text().array(),
		scopes: text().array().notNull(),
		createdAt: timestamptz().notNull(),
		updatedAt: timestamptz().notNull(),
		requestedUserInfoClaims: text().array(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		clientId: text()
			.notNull()
			.references(() => oauthClient.clientId),
	},
	(table) => [
		index("oauth_consent_clientId_idx").on(table.clientId),
		index("oauth_consent_userId_idx").on(table.userId),
	],
);

export const oauthClientAssertion = snakeCase.table("oauth_client_assertion", {
	id: text().primaryKey(),
	expiresAt: timestamptz().notNull(),
});
