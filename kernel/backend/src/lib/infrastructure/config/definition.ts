import {
	booleanField,
	defineConfig,
	enumField,
	group,
	integerField,
	stringField,
} from "@ryot-app/config";
import { Config } from "effect";

const scheduler = group(
	{ label: "Scheduler", description: "Scheduler settings" },
	{
		infrequentCronJobsSchedule: stringField({
			defaultValue: "0 0 * * *",
			label: "Infrequent cron jobs schedule",
			envKey: "SCHEDULER_INFREQUENT_CRON_JOBS_SCHEDULE",
			description: "Cron expression used by plugin crons assigned to the infrequent tier",
		}),
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
			description:
				"Interval phrase for the frequent cron tier; runs are aligned to interval boundaries rather than to process start time",
		}),
	},
);

const users = group(
	{ label: "Users", description: "User account settings" },
	{
		allowRegistration: booleanField({
			defaultValue: true,
			label: "Allow registration",
			envKey: "USERS_ALLOW_REGISTRATION",
			description: "Allow new users to register via email and password",
		}),
		disableLocalAuth: booleanField({
			defaultValue: false,
			label: "Disable local auth",
			envKey: "USERS_DISABLE_LOCAL_AUTH",
			description: "Disable local email/password authentication, requiring OIDC",
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
		umami: group(
			{ label: "Umami", description: "Umami analytics settings" },
			{
				hostUrl: stringField({
					label: "Umami host URL",
					envKey: "FRONTEND_UMAMI_HOST_URL",
					description: "Origin of the Umami instance that receives analytics events",
				}),
				websiteId: stringField({
					label: "Umami website ID",
					envKey: "FRONTEND_UMAMI_WEBSITE_ID",
					description: "Umami website identifier reported alongside analytics events",
				}),
			},
		),
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
			envKey: "DATABASE_POOL_MAX",
			label: "Shared pool maximum",
			description:
				"Maximum number of PostgreSQL connections shared by application and workflow operations",
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
			hidden: true,
			defaultValue: "./tmp",
			label: "Deno directory",
			envKey: "SANDBOX_DENO_DIR",
			description: "Directory used for the local sandbox dependency runtime and Deno cache",
		}),
		processMode: enumField({
			label: "Process mode",
			defaultValue: "on-demand",
			envKey: "SANDBOX_PROCESS_MODE",
			choices: { kind: "static", values: [{ value: "on-demand" }, { value: "warm" }] },
			description: "Spawn processes on demand or keep a warm pool ready for executions",
		}),
		workerConcurrency: integerField({
			defaultValue: 2,
			label: "Worker concurrency",
			envKey: "SANDBOX_WORKER_CONCURRENCY",
			description:
				"Maximum sandbox executions the durable queue runs at once. The default suits the 2 vCPU / 4 GB baseline, where each live execution costs one Deno process and one shared pool connection; raise it only on hosts with spare CPU, memory, and DATABASE_POOL_MAX headroom",
		}),
	},
);

const fileStorage = group(
	{ label: "File storage", description: "S3-compatible and local file storage" },
	{
		region: stringField({
			label: "S3 region",
			description: "S3 bucket region",
			envKey: "FILE_STORAGE_S3_REGION",
		}),
		url: stringField({
			label: "S3 URL",
			envKey: "FILE_STORAGE_S3_URL",
			description: "S3-compatible endpoint URL",
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
		localDir: stringField({
			hidden: true,
			defaultValue: "./storage",
			envKey: "FILE_STORAGE_LOCAL_DIR",
			label: "Local permanent directory",
			description: "Writable persistent directory for permanent local objects",
		}),
		localTempDir: stringField({
			hidden: true,
			defaultValue: "./work",
			label: "Local working directory",
			envKey: "FILE_STORAGE_LOCAL_TEMP_DIR",
			description: "Directory used for temporary uploads, imports, and sandbox working files",
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
		server: stringField({
			label: "SMTP server",
			envKey: "SERVER_SMTP_SERVER",
			description: "SMTP server hostname",
		}),
		user: stringField({
			secret: true,
			label: "SMTP user",
			envKey: "SERVER_SMTP_USER",
			description: "SMTP username",
		}),
		password: stringField({
			secret: true,
			label: "SMTP password",
			description: "SMTP password",
			envKey: "SERVER_SMTP_PASSWORD",
		}),
		mailbox: stringField({
			label: "SMTP mailbox",
			envKey: "SERVER_SMTP_MAILBOX",
			description: "SMTP sender mailbox",
			defaultValue: "Ryot <no-reply@ryot.io>",
		}),
	},
);

const server = group(
	{ label: "Server", description: "Server settings" },
	{
		oidc,
		smtp,
		logFile: stringField({
			label: "Log file",
			envKey: "SERVER_LOG_FILE",
			description: "File path for appended structured logs",
		}),
		logLevel: stringField({
			label: "Log level",
			defaultValue: "info",
			envKey: "SERVER_LOG_LEVEL",
			description: "Minimum application log level",
		}),
		otlpEndpoint: stringField({
			label: "OTLP endpoint",
			envKey: "SERVER_OTLP_ENDPOINT",
			description: "Base URL for OTLP traces and metrics export",
		}),
		proKey: stringField({
			secret: true,
			label: "Pro key",
			envKey: "SERVER_PRO_KEY",
			description: "The key that can be used to enable Ryot Pro features",
		}),
		clientDir: stringField({
			hidden: true,
			defaultValue: "./client",
			label: "Client directory",
			envKey: "SERVER_CLIENT_DIR",
			description: "Directory containing the client application",
		}),
		disableNotifications: booleanField({
			defaultValue: false,
			label: "Disable notifications",
			envKey: "SERVER_DISABLE_NOTIFICATIONS",
			description: "Disable delivery of all notifications",
		}),
		adminAccessToken: stringField({
			secret: true,
			label: "Admin access token",
			validation: { required: true },
			envKey: "SERVER_ADMIN_ACCESS_TOKEN",
			description: "Bearer token required for god-mode admin endpoints",
		}),
		proKeyVerificationUrl: stringField({
			hidden: true,
			label: "Pro key verification URL",
			defaultValue: "https://api.unkey.com",
			envKey: "SERVER_PRO_KEY_VERIFICATION_URL",
			description: "Base URL used to verify the Pro key",
		}),
		otlpHeaders: stringField({
			secret: true,
			label: "OTLP headers",
			envKey: "SERVER_OTLP_HEADERS",
			description:
				"Comma-separated key=value headers sent with OTLP exports, such as the API token a hosted collector requires",
		}),
		pluginsSystemDir: stringField({
			hidden: true,
			defaultValue: "./plugins",
			label: "System plugin directory",
			envKey: "SERVER_PLUGINS_SYSTEM_DIR",
			description:
				"Directory containing deployment-controlled system plugin archives; archives are not cryptographically authenticated",
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
		redisUrl: stringField({
			secret: true,
			label: "Redis URL",
			envKey: "REDIS_URL",
			validation: { required: true },
			description: "Redis connection string",
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
		disableTelemetry: booleanField({
			defaultValue: false,
			label: "Disable telemetry",
			envKey: "DISABLE_TELEMETRY",
			description: "Disable anonymous usage analytics reported by the client",
		}),
		frontendUrl: stringField({
			label: "Frontend URL",
			envKey: "FRONTEND_URL",
			validation: { required: true },
			defaultValue: "https://app.ryot.io",
			description:
				"Exact origin users browse to; defines OAuth issuer and callbacks. HTTPS strongly recommended",
		}),
	},
	{ description: "Application configuration" },
);

export const sandboxDenoDirConfig = Config.String("SANDBOX_DENO_DIR").pipe(
	Config.withDefault("./tmp"),
);
