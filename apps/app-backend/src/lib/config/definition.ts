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
	scheduler: Config.all({
		progressUpdateThresholdHours: Config.integer("SERVER_PROGRESS_UPDATE_THRESHOLD").pipe(
			Config.withDefault(2),
		),
	}),
	sandbox: Config.all({
		timeoutMs: Config.integer("SANDBOX_TIMEOUT_MS").pipe(Config.withDefault(10_000)),
		denoDir: Config.string("SANDBOX_DENO_DIR").pipe(Config.withDefault("/tmp/ryot-sandbox-deno")),
		jobIdSecret: Config.redacted("SANDBOX_JOB_ID_SECRET").pipe(
			Config.withDefault(Redacted.make("changeme")),
		),
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
	fileStorage: Config.all({
		url: Config.string("FILE_STORAGE_S3_URL").pipe(Config.option),
		region: Config.string("FILE_STORAGE_S3_REGION").pipe(Config.option),
		bucketName: Config.string("FILE_STORAGE_S3_BUCKET_NAME").pipe(Config.option),
		accessKeyId: Config.redacted("FILE_STORAGE_S3_ACCESS_KEY_ID").pipe(Config.option),
		secretAccessKey: Config.redacted("FILE_STORAGE_S3_SECRET_ACCESS_KEY").pipe(Config.option),
	}),
});
