import { Config, Redacted } from "effect";

import { field, group } from "./builder";

export const systemConfigDef = group("Core system configuration", {
	port: field(
		{ envKey: "PORT", default: "3000", description: "HTTP port the server listens on" },
		Config.integer("PORT").pipe(Config.withDefault(3000)),
	),
	frontendUrl: field(
		{
			envKey: "FRONTEND_URL",
			default: "http://localhost:3000",
			description: "Public base URL of the frontend application",
		},
		Config.string("FRONTEND_URL").pipe(Config.withDefault("http://localhost:3000")),
	),
	databaseUrl: field(
		{
			sensitive: true,
			envKey: "DATABASE_URL",
			default: "postgres://postgres:postgres@localhost:5432/postgres",
			description: "PostgreSQL connection string for the primary database",
		},
		Config.redacted("DATABASE_URL").pipe(
			Config.withDefault(Redacted.make("postgres://postgres:postgres@localhost:5432/postgres")),
		),
	),
	redisUrl: field(
		{
			sensitive: true,
			envKey: "REDIS_URL",
			default: "redis://localhost:6379",
			description: "Redis connection URL used for caching and session storage",
		},
		Config.redacted("REDIS_URL").pipe(Config.withDefault(Redacted.make("redis://localhost:6379"))),
	),
	users: group("User account settings", {
		allowRegistration: field(
			{
				default: "true",
				envKey: "USERS_ALLOW_REGISTRATION",
				description: "Allow new users to self-register on this instance",
			},
			Config.boolean("USERS_ALLOW_REGISTRATION").pipe(Config.withDefault(true)),
		),
		disableLocalAuth: field(
			{
				default: "false",
				envKey: "USERS_DISABLE_LOCAL_AUTH",
				description: "Disable email/password authentication, forcing OAuth-only login",
			},
			Config.boolean("USERS_DISABLE_LOCAL_AUTH").pipe(Config.withDefault(false)),
		),
	}),
	server: group("Server settings", {
		corsOrigins: field(
			{
				optional: true,
				envKey: "SERVER_CORS_ORIGINS",
				description: "Comma-separated list of allowed CORS origins",
			},
			Config.string("SERVER_CORS_ORIGINS").pipe(Config.option),
		),
		adminAccessToken: field(
			{
				sensitive: true,
				default: "changeme",
				envKey: "SERVER_ADMIN_ACCESS_TOKEN",
				description: "Secret token required for admin API operations",
			},
			Config.redacted("SERVER_ADMIN_ACCESS_TOKEN").pipe(
				Config.withDefault(Redacted.make("changeme")),
			),
		),
		oidc: group("OIDC provider", {
			clientId: field(
				{
					optional: true,
					envKey: "SERVER_OIDC_CLIENT_ID",
					description: "Client ID for the OIDC provider",
				},
				Config.string("SERVER_OIDC_CLIENT_ID").pipe(Config.option),
			),
			issuerUrl: field(
				{
					optional: true,
					envKey: "SERVER_OIDC_ISSUER_URL",
					description: "Issuer/discovery URL for the OIDC provider",
				},
				Config.string("SERVER_OIDC_ISSUER_URL").pipe(Config.option),
			),
			clientSecret: field(
				{
					optional: true,
					sensitive: true,
					envKey: "SERVER_OIDC_CLIENT_SECRET",
					description: "Client secret for the OIDC provider",
				},
				Config.redacted("SERVER_OIDC_CLIENT_SECRET").pipe(Config.option),
			),
		}),
	}),
	frontend: group("Frontend display settings", {
		oidcButtonLabel: field(
			{
				optional: true,
				envKey: "FRONTEND_OIDC_BUTTON_LABEL",
				description: "Label shown on the OIDC sign-in button in the client",
			},
			Config.string("FRONTEND_OIDC_BUTTON_LABEL").pipe(Config.option),
		),
	}),
});
