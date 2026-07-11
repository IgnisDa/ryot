import { Config, ConfigError, Either, LogLevel } from "effect";

import type { ConfigLeaf, FieldMeta } from "./builder";
import { boolField, group, intField, optField, secretField, strField } from "./builder";

const fields = {
	redisUrl: secretField("REDIS_URL", "Redis connection string"),
	databaseUrl: secretField("DATABASE_URL", "PostgreSQL connection string"),
	smtpUser: optField(secretField("SERVER_SMTP_USER", "SMTP username")),
	s3Region: optField(strField("FILE_STORAGE_S3_REGION", "S3 bucket region")),
	oidcClientId: optField(strField("SERVER_OIDC_CLIENT_ID", "OIDC client ID")),
	port: intField("PORT", "HTTP port the server listens on", { default: 8000 }),
	smtpServer: optField(strField("SERVER_SMTP_SERVER", "SMTP server hostname")),
	smtpPassword: optField(secretField("SERVER_SMTP_PASSWORD", "SMTP password")),
	oidcIssuerUrl: optField(strField("SERVER_OIDC_ISSUER_URL", "OIDC issuer URL")),
	s3Url: optField(strField("FILE_STORAGE_S3_URL", "S3-compatible endpoint URL")),
	s3BucketName: optField(strField("FILE_STORAGE_S3_BUCKET_NAME", "S3 bucket name")),
	logFile: optField(strField("SERVER_LOG_FILE", "File path for appended structured logs")),
	tvdbApiKey: optField(secretField("MOVIES_AND_SHOWS_TVDB_API_KEY", "TVDB API key")),
	otlpEndpoint: optField(strField("SERVER_OTLP_ENDPOINT", "Base URL for OTLP trace export")),
	spotifyClientId: optField(strField("MUSIC_SPOTIFY_CLIENT_ID", "Spotify client ID")),
	metronUsername: optField(strField("COMIC_BOOK_METRON_USERNAME", "Metron username")),
	s3AccessKeyId: optField(secretField("FILE_STORAGE_S3_ACCESS_KEY_ID", "S3 access key ID")),
	oidcClientSecret: optField(secretField("SERVER_OIDC_CLIENT_SECRET", "OIDC client secret")),
	listennotesApiKey: optField(secretField("PODCASTS_LISTENNOTES_API_KEY", "ListenNotes API key")),
	frontendUrl: strField("FRONTEND_URL", "Public URL of the frontend application", {
		default: "http://localhost:3000",
	}),
	smtpMailbox: strField("SERVER_SMTP_MAILBOX", "SMTP sender mailbox", {
		default: "Ryot <no-reply@ryot.io>",
	}),
	jobIdSecret: secretField("SANDBOX_JOB_ID_SECRET", "Secret used to sign sandbox job identifiers", {
		default: "changeme",
	}),
	s3SecretAccessKey: optField(
		secretField("FILE_STORAGE_S3_SECRET_ACCESS_KEY", "S3 secret access key"),
	),
	disableNotifications: boolField(
		"SERVER_DISABLE_NOTIFICATIONS",
		"Disable delivery of all notifications",
		{ default: false },
	),
	databaseConnectionTimeoutMs: intField(
		"DATABASE_CONNECTION_TIMEOUT_MS",
		"Maximum milliseconds to wait when acquiring a PostgreSQL connection from the pool",
		{ default: 10_000 },
	),
	databasePoolMax: intField(
		"DATABASE_POOL_MAX",
		"Maximum number of PostgreSQL connections held in the pool",
		{ default: 10 },
	),
	databaseWorkflowPoolMax: intField(
		"DATABASE_WORKFLOW_POOL_MAX",
		"Maximum number of PostgreSQL connections held in the dedicated workflow engine pool",
		{ default: 10 },
	),
	oidcButtonLabel: optField(
		strField("FRONTEND_OIDC_BUTTON_LABEL", "Label for the OIDC sign-in button"),
	),
	corsOrigins: optField(
		strField("SERVER_CORS_ORIGINS", "Comma-separated list of allowed CORS origins"),
	),
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
	builtinExercisePreloadLimit: intField(
		"BUILTIN_EXERCISE_PRELOAD_LIMIT",
		"Maximum number of built-in exercises to preload",
		{ default: 873 },
	),
	frequentCronJobsSchedule: strField(
		"SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE",
		"Interval phrase for the frequent cron tier",
		{ default: "every 5 minutes" },
	),
	infrequentCronJobsSchedule: strField(
		"SCHEDULER_INFREQUENT_CRON_JOBS_SCHEDULE",
		"Cron expression (or the phrase 'every midnight') for the infrequent cron tier",
		{ default: "every midnight" },
	),
	disableBackgroundJobs: boolField(
		"SERVER_DISABLE_BACKGROUND_JOBS",
		"Disable all scheduled background jobs (the frequent/infrequent cron tiers, plugin manifest crons, and the one-time plugin boot dispatcher)",
		{ default: false },
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
		"Directory used for the local sandbox dependency runtime and Deno cache",
		{ default: "/tmp/ryot-sandbox-deno" },
	),
	adminAccessToken: secretField(
		"SERVER_ADMIN_ACCESS_TOKEN",
		"Bearer token required for god-mode admin endpoints",
	),
	nodeEnv: strField("NODE_ENV", "Runtime environment name", {
		hidden: true,
		default: "development",
	}),
	traktClientId: optField(
		strField("SERVER_IMPORTER_TRAKT_CLIENT_ID", "Trakt client ID for the Trakt importer"),
	),
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

const logLevelField = strField("SERVER_LOG_LEVEL", "Minimum application log level", {
	default: "info",
});

const logLevel = {
	meta: logLevelField.meta,
	config: logLevelField.config.pipe(
		Config.mapOrFail((value) => {
			const levels: Record<string, LogLevel.LogLevel> = {
				all: LogLevel.All,
				off: LogLevel.None,
				info: LogLevel.Info,
				none: LogLevel.None,
				debug: LogLevel.Debug,
				error: LogLevel.Error,
				fatal: LogLevel.Fatal,
				trace: LogLevel.Trace,
				warn: LogLevel.Warning,
				warning: LogLevel.Warning,
			};
			const level = levels[value.toLowerCase()];
			return level
				? Either.right(level)
				: Either.left(ConfigError.InvalidData([], `Unsupported SERVER_LOG_LEVEL '${value}'`));
		}),
	),
};

export const sandboxDenoDirConfig = fields.denoDir.config;
export const builtinExercisePreloadLimitConfig = fields.builtinExercisePreloadLimit.config;

const tmpDir: ConfigLeaf<string, FieldMeta> = {
	config: Config.string("TMPDIR").pipe(
		Config.orElse(() => Config.string("TMP")),
		Config.orElse(() => Config.string("TEMP")),
		Config.withDefault("/tmp"),
	),
	meta: {
		hidden: true,
		kind: "field",
		default: "/tmp",
		required: false,
		envKey: "TMPDIR",
		sensitive: false,
		builtinOnly: false,
		description: "Directory for temporary import and upload files",
	},
};

const frontendGroup = group(
	"Frontend display settings",
	Config.all({ oidcButtonLabel: fields.oidcButtonLabel.config }),
	{ oidcButtonLabel: fields.oidcButtonLabel.meta },
);

const smtpGroup = group(
	"SMTP delivery settings",
	Config.all({
		user: fields.smtpUser.config,
		server: fields.smtpServer.config,
		mailbox: fields.smtpMailbox.config,
		password: fields.smtpPassword.config,
	}),
	{
		user: fields.smtpUser.meta,
		server: fields.smtpServer.meta,
		mailbox: fields.smtpMailbox.meta,
		password: fields.smtpPassword.meta,
	},
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
		infrequentCronJobsSchedule: fields.infrequentCronJobsSchedule.config,
	}),
	{
		frequentCronJobsSchedule: fields.frequentCronJobsSchedule.meta,
		infrequentCronJobsSchedule: fields.infrequentCronJobsSchedule.meta,
	},
);

const databaseGroup = group(
	"PostgreSQL connection settings",
	Config.all({
		url: fields.databaseUrl.config,
		poolMax: fields.databasePoolMax.config,
		workflowPoolMax: fields.databaseWorkflowPoolMax.config,
		connectionTimeoutMs: fields.databaseConnectionTimeoutMs.config,
	}),
	{
		url: fields.databaseUrl.meta,
		poolMax: fields.databasePoolMax.meta,
		workflowPoolMax: fields.databaseWorkflowPoolMax.meta,
		connectionTimeoutMs: fields.databaseConnectionTimeoutMs.meta,
	},
);

const sandboxGroup = group(
	"Sandbox execution settings",
	Config.all({
		denoDir: sandboxDenoDirConfig,
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
		smtp: smtpGroup.config,
		logLevel: logLevel.config,
		logFile: fields.logFile.config,
		traktClientId: fields.traktClientId.config,
		corsOrigins: fields.corsOrigins.config,
		otlpEndpoint: fields.otlpEndpoint.config,
		adminAccessToken: fields.adminAccessToken.config,
		disableNotifications: fields.disableNotifications.config,
		disableBackgroundJobs: fields.disableBackgroundJobs.config,
		progressUpdateThresholdHours: fields.progressUpdateThresholdHours.config,
	}),
	{
		oidc: oidcGroup.meta,
		smtp: smtpGroup.meta,
		logLevel: logLevel.meta,
		logFile: fields.logFile.meta,
		traktClientId: fields.traktClientId.meta,
		corsOrigins: fields.corsOrigins.meta,
		otlpEndpoint: fields.otlpEndpoint.meta,
		adminAccessToken: fields.adminAccessToken.meta,
		disableNotifications: fields.disableNotifications.meta,
		disableBackgroundJobs: fields.disableBackgroundJobs.meta,
		progressUpdateThresholdHours: fields.progressUpdateThresholdHours.meta,
	},
);

export const moviesAndShowsConfigDefinition = group(
	"Movies and Shows configuration",
	Config.all({
		tmdbAccessToken: fields.tmdbAccessToken.config,
		tvdbApiKey: fields.tvdbApiKey.config,
	}),
	{
		tmdbAccessToken: fields.tmdbAccessToken.meta,
		tvdbApiKey: fields.tvdbApiKey.meta,
	},
);

export const animeAndMangaConfigDefinition = group(
	"Anime and Manga configuration",
	Config.all({
		malClientId: fields.malClientId.config,
	}),
	{
		malClientId: fields.malClientId.meta,
	},
);

export const comicBooksConfigDefinition = group(
	"Comic Books configuration",
	Config.all({
		metronUsername: fields.metronUsername.config,
		metronPassword: fields.metronPassword.config,
	}),
	{
		metronUsername: fields.metronUsername.meta,
		metronPassword: fields.metronPassword.meta,
	},
);

export const booksConfigDefinition = group(
	"Books configuration",
	Config.all({
		hardcoverApiKey: fields.hardcoverApiKey.config,
		googleBooksApiKey: fields.googleBooksApiKey.config,
	}),
	{
		hardcoverApiKey: fields.hardcoverApiKey.meta,
		googleBooksApiKey: fields.googleBooksApiKey.meta,
	},
);

export const musicConfigDefinition = group(
	"Music configuration",
	Config.all({
		spotifyClientId: fields.spotifyClientId.config,
		spotifyClientSecret: fields.spotifyClientSecret.config,
	}),
	{
		spotifyClientId: fields.spotifyClientId.meta,
		spotifyClientSecret: fields.spotifyClientSecret.meta,
	},
);

export const podcastsConfigDefinition = group(
	"Podcasts configuration",
	Config.all({
		listennotesApiKey: fields.listennotesApiKey.config,
	}),
	{
		listennotesApiKey: fields.listennotesApiKey.meta,
	},
);

export const videoGamesConfigDefinition = group(
	"Video Games configuration",
	Config.all({
		giantBombApiKey: fields.giantBombApiKey.config,
		twitchClientId: fields.twitchClientId.config,
		twitchClientSecret: fields.twitchClientSecret.config,
	}),
	{
		giantBombApiKey: fields.giantBombApiKey.meta,
		twitchClientId: fields.twitchClientId.meta,
		twitchClientSecret: fields.twitchClientSecret.meta,
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
		database: databaseGroup.config,
		timezone: fields.timezone.config,
		redisUrl: fields.redisUrl.config,
		scheduler: schedulerGroup.config,
		fileStorage: fileStorageGroup.config,
		frontendUrl: fields.frontendUrl.config,
		builtinExercisePreloadLimit: builtinExercisePreloadLimitConfig,
	}),
	{
		tmpDir: tmpDir.meta,
		port: fields.port.meta,
		users: usersGroup.meta,
		server: serverGroup.meta,
		sandbox: sandboxGroup.meta,
		nodeEnv: fields.nodeEnv.meta,
		frontend: frontendGroup.meta,
		database: databaseGroup.meta,
		timezone: fields.timezone.meta,
		redisUrl: fields.redisUrl.meta,
		scheduler: schedulerGroup.meta,
		fileStorage: fileStorageGroup.meta,
		frontendUrl: fields.frontendUrl.meta,
		builtinExercisePreloadLimit: fields.builtinExercisePreloadLimit.meta,
	},
);
