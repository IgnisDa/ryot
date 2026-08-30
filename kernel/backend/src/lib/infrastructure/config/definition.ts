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
				"Disable automatic scheduler dispatchers (the frequent/infrequent cron tiers and plugin manifest crons)",
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
		demoAccountId: stringField({
			label: "Demo account ID",
			envKey: "USERS_DEMO_ACCOUNT_ID",
			description: "Existing user ID used by the shared interactive demo",
		}),
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
		experimentInteractiveLane: booleanField({
			hidden: true,
			defaultValue: false,
			label: "Experiment: interactive sandbox lane",
			envKey: "EXPERIMENT_SANDBOX_INTERACTIVE_LANE",
			description: "Benchmark-only: run interactive sandbox executions on one reserved worker",
		}),
		processMode: enumField({
			label: "Process mode",
			defaultValue: "on-demand",
			envKey: "SANDBOX_PROCESS_MODE",
			choices: { kind: "static", values: [{ value: "on-demand" }, { value: "warm" }] },
			description: "Spawn processes on demand or keep a warm pool ready for executions",
		}),
		experimentWorkerPriority: booleanField({
			hidden: true,
			defaultValue: false,
			label: "Experiment: sandbox worker priority",
			envKey: "EXPERIMENT_SANDBOX_WORKER_PRIORITY",
			description:
				"Benchmark-only: lower Deno worker CPU priority and make workers the preferred OOM victims",
		}),
		benchmarkProfileDir: stringField({
			hidden: true,
			label: "Benchmark profile directory",
			envKey: "SANDBOX_BENCHMARK_PROFILE_DIR",
			description:
				"Benchmark-only: absolute directory for admin-gated sandbox and backend profiles; the profiling controls are disabled while it is unset",
		}),
		experimentImportAdmissionLimit: integerField({
			hidden: true,
			defaultValue: 0,
			label: "Experiment: provider import admission limit",
			envKey: "EXPERIMENT_PROVIDER_IMPORT_ADMISSION_LIMIT",
			description:
				"Benchmark-only: active root provider imports admitted at once; 0 starts every import immediately",
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

const observability = group(
	{ label: "Observability", description: "Logging and telemetry export settings" },
	{
		otlp: group(
			{ label: "OTLP export", description: "OpenTelemetry Protocol export settings" },
			{
				endpoint: stringField({
					label: "OTLP endpoint",
					envKey: "OTEL_EXPORTER_OTLP_ENDPOINT",
					description: "Base URL for OTLP logs, traces, and metrics export",
				}),
				headers: stringField({
					secret: true,
					label: "OTLP headers",
					envKey: "OTEL_EXPORTER_OTLP_HEADERS",
					description:
						"Comma-separated key=value headers sent with OTLP exports, such as the API token a hosted collector requires",
				}),
			},
		),
		logging: group(
			{ label: "Logging", description: "Server log output settings" },
			{
				level: stringField({
					label: "Log level",
					defaultValue: "info",
					envKey: "SERVER_LOG_LEVEL",
					description: "Minimum log level for file and OTLP logs; console logs always use info",
				}),
				file: group(
					{ label: "Log file", description: "Rotating structured log file settings" },
					{
						path: stringField({
							label: "Log file path",
							envKey: "SERVER_LOG_FILE",
							defaultValue: "./logs/ryot.log",
							description: "File path for rotating structured logs",
						}),
						rotationSize: stringField({
							defaultValue: "10M",
							label: "Log rotation size",
							envKey: "SERVER_LOG_ROTATION_SIZE",
							description: "Maximum active log file size before rotation, such as 10M",
						}),
						rotationInterval: stringField({
							defaultValue: "1d",
							label: "Log rotation interval",
							envKey: "SERVER_LOG_ROTATION_INTERVAL",
							description: "UTC interval between log rotations, such as 1d",
						}),
					},
				),
			},
		),
	},
);

const server = group(
	{ label: "Server", description: "Server settings" },
	{
		oidc,
		smtp,
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
		observability,
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
		automations: group(
			{ label: "Automations", description: "Automation lifecycle limits and retention" },
			{
				maxDepth: integerField({
					defaultValue: 8,
					label: "Maximum depth",
					envKey: "AUTOMATIONS_MAX_DEPTH",
					description: "Maximum causal chain depth (1–64)",
				}),
				maxRuns: integerField({
					defaultValue: 100,
					label: "Maximum runs",
					envKey: "AUTOMATIONS_MAX_RUNS",
					description: "Maximum runs per root execution (1–10000)",
				}),
				retryWindowDays: integerField({
					defaultValue: 7,
					label: "Retry window",
					envKey: "AUTOMATIONS_RETRY_WINDOW_DAYS",
					description: "Executable and configuration retention in days (1–90)",
				}),
				batchMaxItems: integerField({
					defaultValue: 200,
					label: "Batch trigger size",
					envKey: "AUTOMATIONS_BATCH_MAX_ITEMS",
					description: "Maximum items in one batch change trigger (1–1000)",
				}),
				historyRetentionDays: integerField({
					defaultValue: 30,
					label: "History retention",
					envKey: "AUTOMATIONS_HISTORY_RETENTION_DAYS",
					description: "Automation history retention in days (1–365), at least the retry window",
				}),
			},
		),
	},
	{ description: "Application configuration" },
);

export const sandboxDenoDirConfig = Config.String("SANDBOX_DENO_DIR").pipe(
	Config.withDefault("./tmp"),
);
