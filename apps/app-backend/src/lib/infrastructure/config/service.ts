import type { LogLevel } from "effect";
import { Config, Context, Effect, Layer, Option, Redacted, Schema, SchemaIssue } from "effect";

import { SystemConfigSource, type SystemConfigValue } from "./system";

const logLevels: Record<string, LogLevel.LogLevel> = {
	all: "All",
	off: "None",
	info: "Info",
	warn: "Warn",
	none: "None",
	debug: "Debug",
	error: "Error",
	fatal: "Fatal",
	trace: "Trace",
	warning: "Warn",
};

export type AppConfigValue = Omit<SystemConfigValue, "server"> & {
	readonly server: Omit<SystemConfigValue["server"], "logLevel"> & {
		readonly logLevel: LogLevel.LogLevel;
	};
};

const mapLogLevel = (
	config: SystemConfigValue,
): Effect.Effect<AppConfigValue, Config.ConfigError> => {
	const level = logLevels[config.server.logLevel.toLowerCase()];
	return level
		? Effect.succeed({ ...config, server: { ...config.server, logLevel: level } })
		: Effect.fail(configError(`Unsupported SERVER_LOG_LEVEL '${config.server.logLevel}'`));
};

const configError = (message: string) =>
	new Config.ConfigError(
		new Schema.SchemaError(new SchemaIssue.InvalidValue(Option.none(), { message })),
	);

const isNonEmpty = (opt: Option.Option<string>): opt is Option.Some<string> =>
	Option.isSome(opt) && opt.value.length > 0;

const isNonEmptyRedacted = (
	opt: Option.Option<Redacted.Redacted>,
): opt is Option.Some<Redacted.Redacted> =>
	Option.isSome(opt) && Redacted.value(opt.value).length > 0;

export const isOidcEnabled = (config: AppConfigValue): boolean => {
	const { clientId, clientSecret, issuerUrl } = config.server.oidc;
	return isNonEmpty(clientId) && isNonEmpty(issuerUrl) && isNonEmptyRedacted(clientSecret);
};

export const getSmtpCredentials = (
	config: AppConfigValue,
): Option.Option<{ server: string; user: Redacted.Redacted; password: Redacted.Redacted }> => {
	const { password, server, user } = config.server.smtp;
	if (!isNonEmpty(server) || !isNonEmptyRedacted(user) || !isNonEmptyRedacted(password)) {
		return Option.none();
	}
	return Option.some({ server: server.value, user: user.value, password: password.value });
};

export const isSmtpEnabled = (config: AppConfigValue): boolean =>
	Option.isSome(getSmtpCredentials(config));

export const validateSystemConfig = (
	config: AppConfigValue,
): Effect.Effect<AppConfigValue, Config.ConfigError> =>
	Effect.gen(function* () {
		const { clientId, clientSecret, issuerUrl } = config.server.oidc;
		const oidcSetCount = [
			isNonEmpty(clientId),
			isNonEmpty(issuerUrl),
			isNonEmptyRedacted(clientSecret),
		].filter(Boolean).length;

		if (oidcSetCount > 0 && oidcSetCount < 3) {
			return yield* Effect.fail(
				configError(
					"Partial OIDC configuration detected. Set all three of SERVER_OIDC_CLIENT_ID, SERVER_OIDC_ISSUER_URL, and SERVER_OIDC_CLIENT_SECRET, or none of them.",
				),
			);
		}

		const oidcEnabled = oidcSetCount === 3;
		if (config.users.disableLocalAuth && !oidcEnabled) {
			return yield* Effect.fail(
				configError(
					"USERS_DISABLE_LOCAL_AUTH is set but OIDC credentials are incomplete. Set SERVER_OIDC_CLIENT_ID, SERVER_OIDC_ISSUER_URL, and SERVER_OIDC_CLIENT_SECRET.",
				),
			);
		}

		const { password, server, user } = config.server.smtp;
		const smtpSetCount = [
			isNonEmpty(server),
			isNonEmptyRedacted(user),
			isNonEmptyRedacted(password),
		].filter(Boolean).length;
		if (smtpSetCount > 0 && smtpSetCount < 3) {
			return yield* Effect.fail(
				configError(
					"Partial SMTP configuration detected. Set all three of SERVER_SMTP_SERVER, SERVER_SMTP_USER, and SERVER_SMTP_PASSWORD, or none of them.",
				),
			);
		}

		// The cluster SQL runner permanently reserves one workflow-pool connection,
		// even when advisory shard locks are disabled.
		const usableWorkflowConnections = config.database.workflowPoolMax - 1;
		if (config.sandbox.workerConcurrency > usableWorkflowConnections) {
			return yield* Effect.fail(
				configError(
					`SANDBOX_WORKER_CONCURRENCY (${config.sandbox.workerConcurrency}) exceeds the usable workflow-pool connections (${usableWorkflowConnections}). The cluster SQL runner permanently reserves one connection of DATABASE_WORKFLOW_POOL_MAX (${config.database.workflowPoolMax}), so usable connections = DATABASE_WORKFLOW_POOL_MAX - 1; a higher sandbox worker concurrency starves the workflow engine. Raise DATABASE_WORKFLOW_POOL_MAX or lower SANDBOX_WORKER_CONCURRENCY.`,
				),
			);
		}

		// The +2 accounts for the two always-on DurableQueue workers, concurrency 1 each.
		if (config.sandbox.workerConcurrency + 2 >= usableWorkflowConnections) {
			yield* Effect.logWarning("workflow pool connection headroom exhausted").pipe(
				Effect.annotateLogs({
					usableWorkflowConnections,
					sandboxWorkerConcurrency: config.sandbox.workerConcurrency,
				}),
			);
		}

		return config;
	});

export class AppConfig extends Context.Service<AppConfig>()("AppConfig", {
	make: Effect.gen(function* () {
		const system = yield* SystemConfigSource;
		return yield* validateSystemConfig(yield* mapLogLevel(system));
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
