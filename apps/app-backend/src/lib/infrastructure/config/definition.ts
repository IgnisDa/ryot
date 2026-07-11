import { booleanField, defineConfig, group, integerField, stringField } from "@ryot/config";
import { Config } from "effect";

const scheduler = group(
	{ label: "Scheduler", description: "Scheduler settings" },
	{
		disableDispatchers: booleanField({
			label: "Disable dispatchers",
			envKey: "SCHEDULER_DISABLE_DISPATCHERS",
			defaultValue: false,
			description:
				"Disable automatic scheduler dispatchers (the frequent/infrequent cron tiers, plugin manifest crons, and the one-time plugin boot dispatcher)",
		}),
		frequentCronJobsSchedule: stringField({
			label: "Frequent cron jobs schedule",
			envKey: "SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE",
			defaultValue: "every 5 minutes",
			description: "Interval phrase for the frequent cron tier",
		}),
		infrequentCronJobsSchedule: stringField({
			label: "Infrequent cron jobs schedule",
			envKey: "SCHEDULER_INFREQUENT_CRON_JOBS_SCHEDULE",
			defaultValue: "0 0 * * *",
			description: "Cron expression used by plugin crons assigned to the infrequent tier",
		}),
	},
);

const users = group(
	{ label: "Users", description: "User account settings" },
	{
		disableLocalAuth: booleanField({
			label: "Disable local auth",
			envKey: "USERS_DISABLE_LOCAL_AUTH",
			defaultValue: false,
			description: "Disable local email/password authentication, requiring OIDC",
		}),
		allowRegistration: booleanField({
			label: "Allow registration",
			envKey: "USERS_ALLOW_REGISTRATION",
			defaultValue: true,
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
			label: "Pool maximum",
			envKey: "DATABASE_POOL_MAX",
			defaultValue: 10,
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
			label: "Connection timeout",
			envKey: "DATABASE_CONNECTION_TIMEOUT_MS",
			defaultValue: 10_000,
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
			envKey: "SANDBOX_TIMEOUT_MS",
			defaultValue: 10_000,
			description: "Maximum execution time for a sandbox job in milliseconds",
		}),
		jobIdSecret: stringField({
			secret: true,
			label: "Job ID secret",
			envKey: "SANDBOX_JOB_ID_SECRET",
			defaultValue: "changeme",
			description: "Secret used to sign sandbox job identifiers",
		}),
		workerConcurrency: integerField({
			label: "Worker concurrency",
			envKey: "SANDBOX_WORKER_CONCURRENCY",
			defaultValue: 5,
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
			envKey: "FILE_STORAGE_S3_REGION",
			description: "S3 bucket region",
		}),
		bucketName: stringField({
			label: "S3 bucket name",
			envKey: "FILE_STORAGE_S3_BUCKET_NAME",
			description: "S3 bucket name",
		}),
		accessKeyId: stringField({
			secret: true,
			label: "S3 access key ID",
			envKey: "FILE_STORAGE_S3_ACCESS_KEY_ID",
			description: "S3 access key ID",
		}),
		secretAccessKey: stringField({
			secret: true,
			label: "S3 secret access key",
			envKey: "FILE_STORAGE_S3_SECRET_ACCESS_KEY",
			description: "S3 secret access key",
		}),
	},
);

const oidc = group(
	{ label: "OIDC", description: "OIDC provider" },
	{
		clientId: stringField({
			label: "OIDC client ID",
			envKey: "SERVER_OIDC_CLIENT_ID",
			description: "OIDC client ID",
		}),
		issuerUrl: stringField({
			label: "OIDC issuer URL",
			envKey: "SERVER_OIDC_ISSUER_URL",
			description: "OIDC issuer URL",
		}),
		clientSecret: stringField({
			secret: true,
			label: "OIDC client secret",
			envKey: "SERVER_OIDC_CLIENT_SECRET",
			description: "OIDC client secret",
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
			defaultValue: "Ryot <no-reply@ryot.io>",
			description: "SMTP sender mailbox",
		}),
		password: stringField({
			secret: true,
			label: "SMTP password",
			envKey: "SERVER_SMTP_PASSWORD",
			description: "SMTP password",
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
			envKey: "SERVER_LOG_LEVEL",
			defaultValue: "info",
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
			envKey: "SERVER_ADMIN_ACCESS_TOKEN",
			validation: { required: true },
			description: "Bearer token required for god-mode admin endpoints",
		}),
		disableNotifications: booleanField({
			label: "Disable notifications",
			envKey: "SERVER_DISABLE_NOTIFICATIONS",
			defaultValue: false,
			description: "Disable delivery of all notifications",
		}),
	},
);

export const appConfigDefinition = defineConfig(
	{
		port: integerField({
			label: "Port",
			envKey: "PORT",
			defaultValue: 8000,
			description: "HTTP port the server listens on",
		}),
		tmpDir: stringField({
			hidden: true,
			label: "Temporary directory",
			envKey: "TMPDIR",
			defaultValue: "/tmp",
			description: "Directory for temporary import and upload files",
		}),
		users,
		server,
		sandbox,
		nodeEnv: stringField({
			hidden: true,
			label: "Node environment",
			envKey: "NODE_ENV",
			defaultValue: "development",
			description: "Runtime environment name",
		}),
		frontend,
		database,
		timezone: stringField({
			label: "Timezone",
			envKey: "TZ",
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
		scheduler,
		fileStorage,
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
