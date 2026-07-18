import { booleanField, defineConfig, group, integerField, stringField } from "@ryot/config";
import { Config } from "effect";

const scheduler = group(
	{ label: "Scheduler", description: "Scheduler settings" },
	{
		disableDispatchers: booleanField({
			defaultValue: false,
			label: "Disable dispatchers",
			envKey: "SCHEDULER_DISABLE_DISPATCHERS",
			description:
				"Disable automatic scheduler dispatchers (the frequent/infrequent cron tiers, plugin manifest crons, and the one-time plugin boot dispatcher)",
		}),
		frequentCronJobsSchedule: stringField({
			defaultValue: "every 5 minutes",
			label: "Frequent cron jobs schedule",
			envKey: "SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE",
			description: "Interval phrase for the frequent cron tier",
		}),
		infrequentCronJobsSchedule: stringField({
			defaultValue: "0 0 * * *",
			label: "Infrequent cron jobs schedule",
			envKey: "SCHEDULER_INFREQUENT_CRON_JOBS_SCHEDULE",
			description: "Cron expression used by plugin crons assigned to the infrequent tier",
		}),
	},
);

const users = group(
	{ label: "Users", description: "User account settings" },
	{
		disableLocalAuth: booleanField({
			defaultValue: false,
			label: "Disable local auth",
			envKey: "USERS_DISABLE_LOCAL_AUTH",
			description: "Disable local email/password authentication, requiring OIDC",
		}),
		allowRegistration: booleanField({
			defaultValue: true,
			label: "Allow registration",
			envKey: "USERS_ALLOW_REGISTRATION",
			description: "Allow new users to register via email and password",
		}),
	},
);

const frontend = group(
	{ label: "Frontend", description: "Frontend display settings" },
	{
		oidcButtonLabel: stringField({
			label: "OIDC button label",
			envKey: "FRONTEND_OIDC_BUTTON_LABEL",
			description: "Label for the OIDC sign-in button",
		}),
	},
);

const database = group(
	{ label: "Database", description: "PostgreSQL connection settings" },
	{
		url: stringField({
			secret: true,
			label: "Database URL",
			envKey: "DATABASE_URL",
			validation: { required: true },
			description: "PostgreSQL connection string",
		}),
		poolMax: integerField({
			defaultValue: 10,
			label: "Pool maximum",
			envKey: "DATABASE_POOL_MAX",
			description: "Maximum number of PostgreSQL connections held in the pool",
		}),
		workflowPoolMax: integerField({
			label: "Workflow pool maximum",
			envKey: "DATABASE_WORKFLOW_POOL_MAX",
			defaultValue: 10,
			description:
				"Maximum number of PostgreSQL connections held in the dedicated workflow engine pool",
		}),
		connectionTimeoutMs: integerField({
			defaultValue: 10_000,
			label: "Connection timeout",
			envKey: "DATABASE_CONNECTION_TIMEOUT_MS",
			description:
				"Maximum milliseconds to wait when acquiring a PostgreSQL connection from the pool",
		}),
	},
);

const sandbox = group(
	{ label: "Sandbox", description: "Sandbox execution settings" },
	{
		denoDir: stringField({
			label: "Deno directory",
			envKey: "SANDBOX_DENO_DIR",
			defaultValue: "/tmp/ryot-sandbox-deno",
			description: "Directory used for the local sandbox dependency runtime and Deno cache",
		}),
		timeoutMs: integerField({
			label: "Timeout",
			defaultValue: 10_000,
			envKey: "SANDBOX_TIMEOUT_MS",
			description: "Maximum execution time for a sandbox job in milliseconds",
		}),
		jobIdSecret: stringField({
			secret: true,
			label: "Job ID secret",
			defaultValue: "changeme",
			envKey: "SANDBOX_JOB_ID_SECRET",
			description: "Secret used to sign sandbox job identifiers",
		}),
		workerConcurrency: integerField({
			defaultValue: 5,
			label: "Worker concurrency",
			envKey: "SANDBOX_WORKER_CONCURRENCY",
			description: "Maximum number of concurrent sandbox jobs",
		}),
	},
);

const fileStorage = group(
	{ label: "File storage", description: "S3-compatible file storage" },
	{
		url: stringField({
			label: "S3 URL",
			envKey: "FILE_STORAGE_S3_URL",
			description: "S3-compatible endpoint URL",
		}),
		region: stringField({
			label: "S3 region",
			description: "S3 bucket region",
			envKey: "FILE_STORAGE_S3_REGION",
		}),
		bucketName: stringField({
			label: "S3 bucket name",
			description: "S3 bucket name",
			envKey: "FILE_STORAGE_S3_BUCKET_NAME",
		}),
		accessKeyId: stringField({
			secret: true,
			label: "S3 access key ID",
			description: "S3 access key ID",
			envKey: "FILE_STORAGE_S3_ACCESS_KEY_ID",
		}),
		secretAccessKey: stringField({
			secret: true,
			label: "S3 secret access key",
			description: "S3 secret access key",
			envKey: "FILE_STORAGE_S3_SECRET_ACCESS_KEY",
		}),
	},
);

const oidc = group(
	{ label: "OIDC", description: "OIDC provider" },
	{
		clientId: stringField({
			label: "OIDC client ID",
			description: "OIDC client ID",
			envKey: "SERVER_OIDC_CLIENT_ID",
		}),
		issuerUrl: stringField({
			label: "OIDC issuer URL",
			description: "OIDC issuer URL",
			envKey: "SERVER_OIDC_ISSUER_URL",
		}),
		clientSecret: stringField({
			secret: true,
			label: "OIDC client secret",
			description: "OIDC client secret",
			envKey: "SERVER_OIDC_CLIENT_SECRET",
		}),
	},
);

const smtp = group(
	{ label: "SMTP", description: "SMTP delivery settings" },
	{
		user: stringField({
			secret: true,
			label: "SMTP user",
			envKey: "SERVER_SMTP_USER",
			description: "SMTP username",
		}),
		server: stringField({
			label: "SMTP server",
			envKey: "SERVER_SMTP_SERVER",
			description: "SMTP server hostname",
		}),
		mailbox: stringField({
			label: "SMTP mailbox",
			envKey: "SERVER_SMTP_MAILBOX",
			description: "SMTP sender mailbox",
			defaultValue: "Ryot <no-reply@ryot.io>",
		}),
		password: stringField({
			secret: true,
			label: "SMTP password",
			description: "SMTP password",
			envKey: "SERVER_SMTP_PASSWORD",
		}),
	},
);

const server = group(
	{ label: "Server", description: "Server settings" },
	{
		oidc,
		smtp,
		logLevel: stringField({
			label: "Log level",
			defaultValue: "info",
			envKey: "SERVER_LOG_LEVEL",
			description: "Minimum application log level",
		}),
		logFile: stringField({
			label: "Log file",
			envKey: "SERVER_LOG_FILE",
			description: "File path for appended structured logs",
		}),
		corsOrigins: stringField({
			label: "CORS origins",
			envKey: "SERVER_CORS_ORIGINS",
			description: "Comma-separated list of allowed CORS origins",
		}),
		otlpEndpoint: stringField({
			label: "OTLP endpoint",
			envKey: "SERVER_OTLP_ENDPOINT",
			description: "Base URL for OTLP trace export",
		}),
		adminAccessToken: stringField({
			secret: true,
			label: "Admin access token",
			validation: { required: true },
			envKey: "SERVER_ADMIN_ACCESS_TOKEN",
			description: "Bearer token required for god-mode admin endpoints",
		}),
		disableNotifications: booleanField({
			defaultValue: false,
			label: "Disable notifications",
			envKey: "SERVER_DISABLE_NOTIFICATIONS",
			description: "Disable delivery of all notifications",
		}),
	},
);

export const appConfigDefinition = defineConfig(
	{
		users,
		server,
		sandbox,
		database,
		frontend,
		scheduler,
		fileStorage,
		port: integerField({
			label: "Port",
			envKey: "PORT",
			defaultValue: 8000,
			description: "HTTP port the server listens on",
		}),
		tmpDir: stringField({
			hidden: true,
			envKey: "TMPDIR",
			defaultValue: "/tmp",
			label: "Temporary directory",
			description: "Directory for temporary import and upload files",
		}),
		nodeEnv: stringField({
			hidden: true,
			envKey: "NODE_ENV",
			label: "Node environment",
			defaultValue: "development",
			description: "Runtime environment name",
		}),
		timezone: stringField({
			envKey: "TZ",
			label: "Timezone",
			defaultValue: "Etc/GMT",
			description: "IANA timezone used for interpreting timezone-less datetimes during imports",
		}),
		redisUrl: stringField({
			secret: true,
			label: "Redis URL",
			envKey: "REDIS_URL",
			validation: { required: true },
			description: "Redis connection string",
		}),
		frontendUrl: stringField({
			label: "Frontend URL",
			envKey: "FRONTEND_URL",
			defaultValue: "http://localhost:3000",
			description: "Public URL of the frontend application",
		}),
	},
	{ description: "Application configuration" },
);

export const sandboxDenoDirConfig = Config.string("SANDBOX_DENO_DIR").pipe(
	Config.withDefault("/tmp/ryot-sandbox-deno"),
);
