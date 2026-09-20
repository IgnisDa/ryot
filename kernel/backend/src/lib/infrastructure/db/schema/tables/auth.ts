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
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export const user = snakeCase.table(
	"user",
	{
		image: text(),
		name: text().notNull(),
		id: text().primaryKey(),
		twoFactorEnabled: boolean(),
		email: text().notNull().unique(),
		emailVerified: boolean().default(false).notNull(),
		disabledAt: timestamp({ precision: 3, withTimezone: true }),
		bootstrapCompletedAt: timestamp({ precision: 3, withTimezone: true }),
		createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
		accountGeneration: text()
			.default(sql`gen_random_uuid()::text`)
			.notNull(),
		preferences: jsonb().$type<UserPreferences>().default(defaultUserPreferences).notNull(),
		updatedAt: timestamp({ precision: 3, withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
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
		accessClass: text().default("standard").notNull(),
		expiresAt: timestamp({ precision: 3, withTimezone: true }).notNull(),
		impersonationExpiresAt: timestamp({ precision: 3, withTimezone: true }),
		createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		updatedAt: timestamp({ precision: 3, withTimezone: true })
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
		accessTokenExpiresAt: timestamp({ precision: 3, withTimezone: true }),
		refreshTokenExpiresAt: timestamp({ precision: 3, withTimezone: true }),
		createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		updatedAt: timestamp({ precision: 3, withTimezone: true })
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
		expiresAt: timestamp({ precision: 3, withTimezone: true }).notNull(),
		createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp({ precision: 3, withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
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
		refillInterval: integer(),
		enabled: boolean().default(true),
		requestCount: integer().default(0),
		rateLimitMax: integer().default(10),
		rateLimitEnabled: boolean().default(true),
		configId: text().default("default").notNull(),
		rateLimitTimeWindow: integer().default(86400000),
		expiresAt: timestamp({ precision: 3, withTimezone: true }),
		lastRequest: timestamp({ precision: 3, withTimezone: true }),
		lastRefillAt: timestamp({ precision: 3, withTimezone: true }),
		createdAt: timestamp({ precision: 3, withTimezone: true }).notNull(),
		updatedAt: timestamp({ precision: 3, withTimezone: true }).notNull(),
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
	verified: boolean().notNull(),
	backupCodes: text().notNull(),
	failedVerificationCount: integer().default(0),
	lockedUntil: timestamp({ precision: 3, withTimezone: true }),
	userId: text()
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const jwks = snakeCase.table("jwks", {
	alg: text(),
	crv: text(),
	id: text().primaryKey(),
	publicKey: text().notNull(),
	privateKey: text().notNull(),
	expiresAt: timestamp({ precision: 3, withTimezone: true }),
	createdAt: timestamp({ precision: 3, withTimezone: true }).notNull(),
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
		createdAt: timestamp({ precision: 3, withTimezone: true }),
		updatedAt: timestamp({ precision: 3, withTimezone: true }),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("oauth_client_userId_idx").on(table.userId)],
);

export const oauthResource = snakeCase.table("oauth_resource", {
	signingKeyId: text(),
	name: text().notNull(),
	id: text().primaryKey(),
	signingAlgorithm: text(),
	accessTokenTtl: integer(),
	refreshTokenTtl: integer(),
	allowedScopes: text().array(),
	disabled: boolean().default(false),
	policyVersion: integer().default(1),
	identifier: text().notNull().unique(),
	metadata: jsonb().$type<Record<string, unknown>>(),
	customClaims: jsonb().$type<Record<string, unknown>>(),
	dpopBoundAccessTokensRequired: boolean().default(false),
	createdAt: timestamp({ precision: 3, withTimezone: true }),
	updatedAt: timestamp({ precision: 3, withTimezone: true }),
});

export const oauthClientResource = snakeCase.table(
	"oauth_client_resource",
	{
		id: text().primaryKey(),
		metadata: jsonb().$type<Record<string, unknown>>(),
		createdAt: timestamp({ precision: 3, withTimezone: true }),
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
		id: text().primaryKey(),
		resources: text().array(),
		authorizationCodeId: text(),
		rotationReplayResponse: text(),
		token: text().notNull().unique(),
		scopes: text().array().notNull(),
		requestedUserInfoClaims: text().array(),
		confirmation: jsonb().$type<Record<string, unknown>>(),
		revoked: timestamp({ precision: 3, withTimezone: true }),
		authTime: timestamp({ precision: 3, withTimezone: true }),
		rotatedAt: timestamp({ precision: 3, withTimezone: true }),
		expiresAt: timestamp({ precision: 3, withTimezone: true }).notNull(),
		createdAt: timestamp({ precision: 3, withTimezone: true }).notNull(),
		rotationReplayExpiresAt: timestamp({ precision: 3, withTimezone: true }),
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
		id: text().primaryKey(),
		resources: text().array(),
		authorizationCodeId: text(),
		scopes: text().array().notNull(),
		requestedUserInfoClaims: text().array(),
		confirmation: jsonb().$type<Record<string, unknown>>(),
		revoked: timestamp({ precision: 3, withTimezone: true }),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		expiresAt: timestamp({ precision: 3, withTimezone: true }).notNull(),
		createdAt: timestamp({ precision: 3, withTimezone: true }).notNull(),
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
		requestedUserInfoClaims: text().array(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp({ precision: 3, withTimezone: true }).notNull(),
		updatedAt: timestamp({ precision: 3, withTimezone: true }).notNull(),
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
	expiresAt: timestamp({ precision: 3, withTimezone: true }).notNull(),
});
