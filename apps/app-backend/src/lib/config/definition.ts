import { Config, Redacted } from "effect";

export const systemConfigDef = Config.all({
	port: Config.integer("PORT").pipe(Config.withDefault(3000)),
	frontendUrl: Config.string("FRONTEND_URL").pipe(Config.withDefault("http://localhost:3000")),
	frontend: Config.all({
		oidcButtonLabel: Config.string("FRONTEND_OIDC_BUTTON_LABEL").pipe(Config.option),
	}),
	databaseUrl: Config.redacted("DATABASE_URL").pipe(
		Config.withDefault(Redacted.make("postgres://postgres:postgres@localhost:5432/postgres")),
	),
	redisUrl: Config.redacted("REDIS_URL").pipe(
		Config.withDefault(Redacted.make("redis://localhost:6379")),
	),
	users: Config.all({
		allowRegistration: Config.boolean("USERS_ALLOW_REGISTRATION").pipe(Config.withDefault(true)),
		disableLocalAuth: Config.boolean("USERS_DISABLE_LOCAL_AUTH").pipe(Config.withDefault(false)),
	}),
	server: Config.all({
		corsOrigins: Config.string("SERVER_CORS_ORIGINS").pipe(Config.option),
		adminAccessToken: Config.redacted("SERVER_ADMIN_ACCESS_TOKEN").pipe(
			Config.withDefault(Redacted.make("changeme")),
		),
		oidc: Config.all({
			clientId: Config.string("SERVER_OIDC_CLIENT_ID").pipe(Config.option),
			issuerUrl: Config.string("SERVER_OIDC_ISSUER_URL").pipe(Config.option),
			clientSecret: Config.redacted("SERVER_OIDC_CLIENT_SECRET").pipe(Config.option),
		}),
	}),
});
