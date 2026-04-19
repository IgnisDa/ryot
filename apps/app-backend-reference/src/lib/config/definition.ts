import { Config, Redacted } from "effect";

import { field, group } from "./builder";

export const systemConfigDef = group("Core system configuration", {
	port: field(
		{
			envKey: "PORT",
			description: "HTTP port the server listens on",
			default: "3000",
		},
		Config.integer("PORT").pipe(Config.withDefault(3000)),
	),
	frontendUrl: field(
		{
			envKey: "FRONTEND_URL",
			description: "Public base URL of the frontend application",
			default: "http://localhost:3000",
		},
		Config.string("FRONTEND_URL").pipe(Config.withDefault("http://localhost:3000")),
	),
	redisUrl: field(
		{
			envKey: "REDIS_URL",
			description: "Redis connection URL used for caching and session storage",
			sensitive: true,
			default: "redis://localhost:6379",
		},
		Config.redacted("REDIS_URL").pipe(Config.withDefault(Redacted.make("redis://localhost:6379"))),
	),
	databaseUrl: field(
		{
			envKey: "DATABASE_URL",
			description: "PostgreSQL connection string for the primary database",
			sensitive: true,
			default: "postgres://postgres:postgres@localhost:5432/postgres",
		},
		Config.redacted("DATABASE_URL").pipe(
			Config.withDefault(
				Redacted.make("postgres://postgres:postgres@localhost:5432/ryot_reference"),
			),
		),
	),
	users: group("User account settings", {
		allowRegistration: field(
			{
				envKey: "USERS_ALLOW_REGISTRATION",
				description: "Allow new users to self-register on this instance",
				default: "true",
			},
			Config.boolean("USERS_ALLOW_REGISTRATION").pipe(Config.withDefault(true)),
		),
		disableLocalAuth: field(
			{
				envKey: "USERS_DISABLE_LOCAL_AUTH",
				description: "Disable email/password authentication, forcing OAuth-only login",
				default: "false",
			},
			Config.boolean("USERS_DISABLE_LOCAL_AUTH").pipe(Config.withDefault(false)),
		),
	}),
	server: group("Server settings", {
		corsOrigins: field(
			{
				envKey: "SERVER_CORS_ORIGINS",
				description: "Comma-separated list of allowed CORS origins",
				optional: true,
			},
			Config.string("SERVER_CORS_ORIGINS").pipe(Config.option),
		),
		adminAccessToken: field(
			{
				envKey: "SERVER_ADMIN_ACCESS_TOKEN",
				description: "Secret token required for admin API operations",
				sensitive: true,
				default: "reference-secret",
			},
			Config.redacted("SERVER_ADMIN_ACCESS_TOKEN").pipe(
				Config.withDefault(Redacted.make("reference-secret")),
			),
		),
		oidc: group("OIDC provider", {
			clientId: field(
				{
					envKey: "SERVER_OIDC_CLIENT_ID",
					description: "Client ID for the OIDC provider",
					optional: true,
				},
				Config.string("SERVER_OIDC_CLIENT_ID").pipe(Config.option),
			),
			issuerUrl: field(
				{
					envKey: "SERVER_OIDC_ISSUER_URL",
					description: "Issuer/discovery URL for the OIDC provider",
					optional: true,
				},
				Config.string("SERVER_OIDC_ISSUER_URL").pipe(Config.option),
			),
			clientSecret: field(
				{
					envKey: "SERVER_OIDC_CLIENT_SECRET",
					description: "Client secret for the OIDC provider",
					optional: true,
					sensitive: true,
				},
				Config.redacted("SERVER_OIDC_CLIENT_SECRET").pipe(Config.option),
			),
		}),
	}),
	sandbox: group("Sandbox settings", {
		denoDir: field(
			{
				envKey: "RYOT_SANDBOX_DENO_DIR",
				description: "Directory for the Deno runtime cache used by the sandbox",
				default: "./.deno",
			},
			Config.string("RYOT_SANDBOX_DENO_DIR").pipe(Config.withDefault("./.deno")),
		),
		timeoutMs: field(
			{
				envKey: "RYOT_SANDBOX_TIMEOUT_MS",
				description: "Maximum execution time in milliseconds for sandbox operations",
				default: "10000",
			},
			Config.integer("RYOT_SANDBOX_TIMEOUT_MS").pipe(Config.withDefault(10_000)),
		),
	}),
});
