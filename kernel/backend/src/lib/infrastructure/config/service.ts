import { isLoopbackOrigin } from "@ryot-app/contract/oauth";
import type { LogLevel } from "effect";
import {
	Config,
	Context,
	Effect,
	Layer,
	Option,
	Redacted,
	Result,
	Schema,
	SchemaIssue,
} from "effect";

import { SANDBOX_LIMITS } from "../sandbox-runtime/limits";
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

const mapLogLevel = (config: SystemConfigValue) => {
	const level = logLevels[config.server.logLevel.toLowerCase()];
	return level
		? Effect.succeed({ ...config, server: { ...config.server, logLevel: level } })
		: Effect.fail(configError(`Unsupported SERVER_LOG_LEVEL '${config.server.logLevel}'`));
};

const configError = (message: string) =>
	new Config.ConfigError(new Schema.SchemaError(new SchemaIssue.InvalidValue({ message })));

const isNonEmpty = (opt: Option.Option<string>): opt is Option.Some<string> =>
	Option.isSome(opt) && opt.value.length > 0;

const isNonEmptyRedacted = (
	opt: Option.Option<Redacted.Redacted>,
): opt is Option.Some<Redacted.Redacted> =>
	Option.isSome(opt) && Redacted.value(opt.value).length > 0;

const normalizePath = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");

const pathsOverlap = (root: string, target: string) =>
	target === root || target.startsWith(`${root}/`);

const otlpEndpointError = (endpoint: string) => {
	const parsed = Result.try(() => new URL(endpoint));
	if (Result.isFailure(parsed)) {
		return "SERVER_OTLP_ENDPOINT must be an absolute HTTP or HTTPS URL.";
	}
	const url = parsed.success;
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return "SERVER_OTLP_ENDPOINT must be an absolute HTTP or HTTPS URL.";
	}
	if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
		return "SERVER_OTLP_ENDPOINT must not contain a query, fragment, or credentials.";
	}
	if (/\/v1\/traces\/*$/i.test(url.pathname)) {
		return "SERVER_OTLP_ENDPOINT must be the collector base URL without '/v1/traces'; the signal path is appended automatically.";
	}
	return undefined;
};

export const parseOtlpHeaders = (value: string): Result.Result<Record<string, string>, string> => {
	const headers: Record<string, string> = {};
	for (const [index, entry] of value.split(",").entries()) {
		const trimmed = entry.trim();
		if (trimmed.length === 0) {
			continue;
		}
		const separator = trimmed.indexOf("=");
		const name = separator === -1 ? "" : trimmed.slice(0, separator).trim();
		const headerValue = separator === -1 ? "" : trimmed.slice(separator + 1).trim();
		if (name.length === 0) {
			return Result.fail(`entry ${index + 1} is not a key=value pair`);
		}
		if (headerValue.length === 0) {
			return Result.fail(`header '${name}' has an empty value`);
		}
		headers[name] = headerValue;
	}
	return Object.keys(headers).length === 0
		? Result.fail("it is set but contains no headers")
		: Result.succeed(headers);
};

export const isOidcEnabled = (config: AppConfigValue): boolean => {
	const { clientId, issuerUrl, clientSecret } = config.server.oidc;
	return isNonEmpty(clientId) && isNonEmpty(issuerUrl) && isNonEmptyRedacted(clientSecret);
};

export const getSmtpCredentials = (
	config: AppConfigValue,
): Option.Option<{ server: string; user: Redacted.Redacted; password: Redacted.Redacted }> => {
	const { user, server, password } = config.server.smtp;
	if (!isNonEmpty(server) || !isNonEmptyRedacted(user) || !isNonEmptyRedacted(password)) {
		return Option.none();
	}
	return Option.some({ user: user.value, server: server.value, password: password.value });
};

export const isSmtpEnabled = (config: AppConfigValue): boolean =>
	Option.isSome(getSmtpCredentials(config));

export const isS3Configured = (config: AppConfigValue): boolean => {
	const { url, bucketName, accessKeyId, secretAccessKey } = config.fileStorage;
	return (
		isNonEmpty(url) &&
		isNonEmpty(bucketName) &&
		isNonEmptyRedacted(accessKeyId) &&
		isNonEmptyRedacted(secretAccessKey)
	);
};

export const validateSystemConfig = (config: AppConfigValue) =>
	Effect.gen(function* () {
		const frontendUrl = yield* Effect.try({
			try: () => new URL(config.frontendUrl),
			catch: () => configError("FRONTEND_URL must be an absolute HTTP or HTTPS origin."),
		});
		if (
			!/^https?:\/\/[^/?#]+\/?$/i.test(config.frontendUrl) ||
			(frontendUrl.protocol !== "http:" && frontendUrl.protocol !== "https:") ||
			frontendUrl.pathname !== "/" ||
			frontendUrl.search !== "" ||
			frontendUrl.hash !== "" ||
			frontendUrl.username !== "" ||
			frontendUrl.password !== ""
		) {
			return yield* Effect.fail(
				configError(
					"FRONTEND_URL must be an absolute HTTP or HTTPS origin without a path, query, or fragment.",
				),
			);
		}

		if (frontendUrl.protocol === "http:" && !isLoopbackOrigin(frontendUrl.origin)) {
			yield* Effect.logWarning(
				"FRONTEND_URL uses plain HTTP, so logins and API keys cross the network unencrypted and anyone on it can read them. Use HTTPS for anything reachable from the internet.",
			).pipe(Effect.annotateLogs({ frontendUrl: frontendUrl.origin }));
		}

		if (Option.isSome(config.server.otlpEndpoint)) {
			const endpointError = otlpEndpointError(config.server.otlpEndpoint.value);
			if (endpointError !== undefined) {
				return yield* Effect.fail(configError(endpointError));
			}
		}

		if (Option.isSome(config.server.otlpHeaders)) {
			const headers = parseOtlpHeaders(Redacted.value(config.server.otlpHeaders.value));
			if (Result.isFailure(headers)) {
				return yield* Effect.fail(
					configError(`SERVER_OTLP_HEADERS is invalid: ${headers.failure}.`),
				);
			}
		}

		const { clientId, issuerUrl, clientSecret } = config.server.oidc;
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

		const { user, server, password } = config.server.smtp;
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

		const permanentPath = normalizePath(config.fileStorage.localDir);
		const temporaryPath = normalizePath(config.fileStorage.localTempDir);
		if (pathsOverlap(permanentPath, temporaryPath) || pathsOverlap(temporaryPath, permanentPath)) {
			return yield* Effect.fail(
				configError("FILE_STORAGE_LOCAL_DIR and FILE_STORAGE_LOCAL_TEMP_DIR must not overlap."),
			);
		}

		// The cluster SQL runner permanently reserves one shared application/workflow-pool
		// connection, even when advisory shard locks are disabled.
		const usablePoolConnections = config.database.poolMax - 1;
		if (SANDBOX_LIMITS.workerConcurrency > usablePoolConnections) {
			return yield* Effect.fail(
				configError(
					`SANDBOX_LIMITS.workerConcurrency (${SANDBOX_LIMITS.workerConcurrency}) exceeds the usable shared application/workflow-pool connections (${usablePoolConnections}). The cluster SQL runner permanently reserves one connection of DATABASE_POOL_MAX (${config.database.poolMax}), so usable connections = DATABASE_POOL_MAX - 1; the shared application/workflow pool cannot support the fixed sandbox worker limit. Raise DATABASE_POOL_MAX.`,
				),
			);
		}

		// The +2 accounts for the two always-on DurableQueue workers, concurrency 1 each.
		if (SANDBOX_LIMITS.workerConcurrency + 2 >= usablePoolConnections) {
			yield* Effect.logWarning(
				"shared application/workflow pool connection headroom exhausted",
			).pipe(
				Effect.annotateLogs({
					usablePoolConnections,
					sandboxWorkerConcurrency: SANDBOX_LIMITS.workerConcurrency,
				}),
			);
		}

		return { ...config, frontendUrl: frontendUrl.origin };
	});

export class AppConfig extends Context.Service<AppConfig>()("AppConfig", {
	make: Effect.gen(function* () {
		const system = yield* SystemConfigSource;
		return yield* validateSystemConfig(yield* mapLogLevel(system));
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
