import { Config } from "effect";

import type { ConfigLeaf, FieldMeta } from "./builder";
import { boolField, group, intField, optField, secretField, strField } from "./builder";

const fields = {
	s3Region: optField(strField("FILE_STORAGE_S3_REGION", "S3 bucket region")),
	oidcClientId: optField(strField("SERVER_OIDC_CLIENT_ID", "OIDC client ID")),
	port: intField("PORT", "HTTP port the server listens on", { default: 8000 }),
	oidcIssuerUrl: optField(strField("SERVER_OIDC_ISSUER_URL", "OIDC issuer URL")),
	s3Url: optField(strField("FILE_STORAGE_S3_URL", "S3-compatible endpoint URL")),
	s3BucketName: optField(strField("FILE_STORAGE_S3_BUCKET_NAME", "S3 bucket name")),
	s3AccessKeyId: optField(secretField("FILE_STORAGE_S3_ACCESS_KEY_ID", "S3 access key ID")),
	oidcClientSecret: optField(secretField("SERVER_OIDC_CLIENT_SECRET", "OIDC client secret")),
	frontendUrl: strField("FRONTEND_URL", "Public URL of the frontend application", {
		default: "http://localhost:3000",
	}),
	redisUrl: secretField("REDIS_URL", "Redis connection string", {
		default: "redis://localhost:6379",
	}),
	s3SecretAccessKey: optField(
		secretField("FILE_STORAGE_S3_SECRET_ACCESS_KEY", "S3 secret access key"),
	),
	databaseUrl: secretField("DATABASE_URL", "PostgreSQL connection string", {
		default: "postgres://postgres:postgres@localhost:5432/postgres",
	}),
	oidcButtonLabel: optField(
		strField("FRONTEND_OIDC_BUTTON_LABEL", "Label for the OIDC sign-in button"),
	),
	corsOrigins: optField(
		strField("SERVER_CORS_ORIGINS", "Comma-separated list of allowed CORS origins"),
	),
	jobIdSecret: secretField("SANDBOX_JOB_ID_SECRET", "Secret used to sign sandbox job identifiers", {
		default: "changeme",
	}),
	timezone: strField(
		"TZ",
		"IANA timezone used for interpreting timezone-less datetimes during imports",
		{ default: "Etc/GMT" },
	),
	allowRegistration: boolField(
		"USERS_ALLOW_REGISTRATION",
		"Allow new users to register via email and password",
		{ default: true },
	),
	disableLocalAuth: boolField(
		"USERS_DISABLE_LOCAL_AUTH",
		"Disable local email/password authentication, requiring OIDC",
		{ default: false },
	),
	progressUpdateThresholdHours: intField(
		"SERVER_PROGRESS_UPDATE_THRESHOLD",
		"Minimum hours between automatic progress updates for an entity",
		{ default: 2 },
	),
	frequentCronJobsSchedule: strField(
		"SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE",
		"Interval phrase used to poll enabled yank integrations",
		{ default: "every 5 minutes" },
	),
	builtinExercisePreloadLimit: intField(
		"BUILTIN_EXERCISE_PRELOAD_LIMIT",
		"Maximum number of built-in exercise entities to preload",
		{ default: 873 },
	),
	timeoutMs: intField(
		"SANDBOX_TIMEOUT_MS",
		"Maximum execution time for a sandbox job in milliseconds",
		{ default: 10_000 },
	),
	workerConcurrency: intField(
		"SANDBOX_WORKER_CONCURRENCY",
		"Maximum number of concurrent sandbox jobs",
		{ default: 5 },
	),
	denoDir: strField(
		"SANDBOX_DENO_DIR",
		"Directory used by Deno for caching modules inside the sandbox",
		{ default: "/tmp/ryot-sandbox-deno" },
	),
	adminAccessToken: secretField(
		"SERVER_ADMIN_ACCESS_TOKEN",
		"Bearer token required for god-mode admin endpoints",
		{ default: "changeme" },
	),
	nodeEnv: strField("NODE_ENV", "Runtime environment name", {
		hidden: true,
		default: "development",
	}),
	traktClientId: optField(
		strField("SERVER_IMPORTER_TRAKT_CLIENT_ID", "Trakt client ID for the Trakt importer"),
	),
	tvdbApiKey: optField(secretField("MOVIES_AND_SHOWS_TVDB_API_KEY", "TVDB API key")),
	spotifyClientId: optField(strField("MUSIC_SPOTIFY_CLIENT_ID", "Spotify client ID")),
	metronUsername: optField(strField("COMIC_BOOK_METRON_USERNAME", "Metron username")),
	listennotesApiKey: optField(secretField("PODCASTS_LISTENNOTES_API_KEY", "ListenNotes API key")),
	malClientId: optField(
		strField("ANIME_AND_MANGA_MAL_CLIENT_ID", "MyAnimeList client ID for anime and manga lookups"),
	),
	twitchClientId: optField(
		strField("VIDEO_GAMES_TWITCH_CLIENT_ID", "Twitch client ID for IGDB video game lookups"),
	),
	hardcoverApiKey: optField(
		secretField("BOOKS_HARDCOVER_API_KEY", "Hardcover API key for the Hardcover book importer"),
	),
	googleBooksApiKey: optField(
		secretField("BOOKS_GOOGLE_BOOKS_API_KEY", "Google Books API key for ISBN book lookups"),
	),
	metronPassword: optField(secretField("COMIC_BOOK_METRON_PASSWORD", "Metron password")),
	spotifyClientSecret: optField(
		secretField("MUSIC_SPOTIFY_CLIENT_SECRET", "Spotify client secret"),
	),
	giantBombApiKey: optField(
		secretField("VIDEO_GAMES_GIANT_BOMB_API_KEY", "Giant Bomb API key for the Grouvee importer"),
	),
	twitchClientSecret: optField(
		secretField(
			"VIDEO_GAMES_TWITCH_CLIENT_SECRET",
			"Twitch client secret for IGDB video game lookups",
		),
	),
	tmdbAccessToken: optField(
		secretField(
			"MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN",
			"TMDB access token for movie and show lookups",
		),
	),
};

const tmpDir: ConfigLeaf<string, FieldMeta> = {
	config: Config.string("TMPDIR").pipe(
		Config.orElse(() => Config.string("TMP")),
		Config.orElse(() => Config.string("TEMP")),
		Config.withDefault("/tmp"),
	),
	meta: {
		hidden: true,
		sensitive: false,
		kind: "field",
		default: "/tmp",
		required: false,
		envKey: "TMPDIR",
		description: "Directory for temporary import and upload files",
	},
};

const frontendGroup = group(
	"Frontend display settings",
	Config.all({ oidcButtonLabel: fields.oidcButtonLabel.config }),
	{ oidcButtonLabel: fields.oidcButtonLabel.meta },
);

const usersGroup = group(
	"User account settings",
	Config.all({
		disableLocalAuth: fields.disableLocalAuth.config,
		allowRegistration: fields.allowRegistration.config,
	}),
	{
		disableLocalAuth: fields.disableLocalAuth.meta,
		allowRegistration: fields.allowRegistration.meta,
	},
);

const schedulerGroup = group(
	"Scheduler settings",
	Config.all({
		frequentCronJobsSchedule: fields.frequentCronJobsSchedule.config,
		progressUpdateThresholdHours: fields.progressUpdateThresholdHours.config,
	}),
	{
		frequentCronJobsSchedule: fields.frequentCronJobsSchedule.meta,
		progressUpdateThresholdHours: fields.progressUpdateThresholdHours.meta,
	},
);

const sandboxGroup = group(
	"Sandbox execution settings",
	Config.all({
		denoDir: fields.denoDir.config,
		timeoutMs: fields.timeoutMs.config,
		jobIdSecret: fields.jobIdSecret.config,
		workerConcurrency: fields.workerConcurrency.config,
	}),
	{
		denoDir: fields.denoDir.meta,
		timeoutMs: fields.timeoutMs.meta,
		jobIdSecret: fields.jobIdSecret.meta,
		workerConcurrency: fields.workerConcurrency.meta,
	},
);

const oidcGroup = group(
	"OIDC provider",
	Config.all({
		clientId: fields.oidcClientId.config,
		issuerUrl: fields.oidcIssuerUrl.config,
		clientSecret: fields.oidcClientSecret.config,
	}),
	{
		clientId: fields.oidcClientId.meta,
		issuerUrl: fields.oidcIssuerUrl.meta,
		clientSecret: fields.oidcClientSecret.meta,
	},
);

const serverGroup = group(
	"Server settings",
	Config.all({
		oidc: oidcGroup.config,
		corsOrigins: fields.corsOrigins.config,
		adminAccessToken: fields.adminAccessToken.config,
	}),
	{
		oidc: oidcGroup.meta,
		corsOrigins: fields.corsOrigins.meta,
		adminAccessToken: fields.adminAccessToken.meta,
	},
);

const fileStorageGroup = group(
	"S3-compatible file storage",
	Config.all({
		url: fields.s3Url.config,
		region: fields.s3Region.config,
		bucketName: fields.s3BucketName.config,
		accessKeyId: fields.s3AccessKeyId.config,
		secretAccessKey: fields.s3SecretAccessKey.config,
	}),
	{
		url: fields.s3Url.meta,
		region: fields.s3Region.meta,
		bucketName: fields.s3BucketName.meta,
		accessKeyId: fields.s3AccessKeyId.meta,
		secretAccessKey: fields.s3SecretAccessKey.meta,
	},
);

export const systemConfigDefinition = group(
	"Core system configuration",
	Config.all({
		tmpDir: tmpDir.config,
		port: fields.port.config,
		users: usersGroup.config,
		server: serverGroup.config,
		sandbox: sandboxGroup.config,
		nodeEnv: fields.nodeEnv.config,
		frontend: frontendGroup.config,
		timezone: fields.timezone.config,
		redisUrl: fields.redisUrl.config,
		scheduler: schedulerGroup.config,
		fileStorage: fileStorageGroup.config,
		frontendUrl: fields.frontendUrl.config,
		databaseUrl: fields.databaseUrl.config,
		builtinExercisePreloadLimit: fields.builtinExercisePreloadLimit.config,
	}),
	{
		tmpDir: tmpDir.meta,
		port: fields.port.meta,
		users: usersGroup.meta,
		server: serverGroup.meta,
		sandbox: sandboxGroup.meta,
		nodeEnv: fields.nodeEnv.meta,
		frontend: frontendGroup.meta,
		timezone: fields.timezone.meta,
		redisUrl: fields.redisUrl.meta,
		scheduler: schedulerGroup.meta,
		fileStorage: fileStorageGroup.meta,
		frontendUrl: fields.frontendUrl.meta,
		databaseUrl: fields.databaseUrl.meta,
		builtinExercisePreloadLimit: fields.builtinExercisePreloadLimit.meta,
	},
);

export const providerConfigDefinition = group(
	"Provider integration configuration",
	Config.all({
		tvdbApiKey: fields.tvdbApiKey.config,
		malClientId: fields.malClientId.config,
		traktClientId: fields.traktClientId.config,
		metronUsername: fields.metronUsername.config,
		twitchClientId: fields.twitchClientId.config,
		metronPassword: fields.metronPassword.config,
		tmdbAccessToken: fields.tmdbAccessToken.config,
		hardcoverApiKey: fields.hardcoverApiKey.config,
		spotifyClientId: fields.spotifyClientId.config,
		giantBombApiKey: fields.giantBombApiKey.config,
		googleBooksApiKey: fields.googleBooksApiKey.config,
		listennotesApiKey: fields.listennotesApiKey.config,
		twitchClientSecret: fields.twitchClientSecret.config,
		spotifyClientSecret: fields.spotifyClientSecret.config,
	}),
	{
		tvdbApiKey: fields.tvdbApiKey.meta,
		malClientId: fields.malClientId.meta,
		traktClientId: fields.traktClientId.meta,
		metronUsername: fields.metronUsername.meta,
		twitchClientId: fields.twitchClientId.meta,
		metronPassword: fields.metronPassword.meta,
		tmdbAccessToken: fields.tmdbAccessToken.meta,
		hardcoverApiKey: fields.hardcoverApiKey.meta,
		spotifyClientId: fields.spotifyClientId.meta,
		giantBombApiKey: fields.giantBombApiKey.meta,
		googleBooksApiKey: fields.googleBooksApiKey.meta,
		listennotesApiKey: fields.listennotesApiKey.meta,
		twitchClientSecret: fields.twitchClientSecret.meta,
		spotifyClientSecret: fields.spotifyClientSecret.meta,
	},
);
