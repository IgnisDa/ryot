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

import { parseEgressAllowedNetworks } from "../egress/address-policy";
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

export type AppConfigValue = Effect.Success<ReturnType<typeof validateSystemConfig>>;

const mapLogLevel = (config: SystemConfigValue) => {
	const level = logLevels[config.observability.logging.level.toLowerCase()];
	return level
		? Effect.succeed({
				...config,
				observability: {
					...config.observability,
					logging: { ...config.observability.logging, level },
				},
			})
		: Effect.fail(
				configError(`Unsupported SERVER_LOG_LEVEL '${config.observability.logging.level}'`),
			);
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

const isValidRotationSize = (value: string) => /^[1-9]\d*[BKMG]$/.test(value);

const isValidRotationInterval = (value: string) => {
	const match = /^([1-9]\d*)([smhdM])$/.exec(value);
	if (match === null) {
		return false;
	}
	const amount = Number(match[1]);
	if (match[2] === "s" || match[2] === "m") {
		return 60 % amount === 0;
	}
	if (match[2] === "h") {
		return 24 % amount === 0;
	}
	return true;
};

const otlpEndpointError = (endpoint: string) => {
	const parsed = Result.try(() => new URL(endpoint));
	if (Result.isFailure(parsed)) {
		return "OTEL_EXPORTER_OTLP_ENDPOINT must be an absolute HTTP or HTTPS URL.";
	}
	const url = parsed.success;
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return "OTEL_EXPORTER_OTLP_ENDPOINT must be an absolute HTTP or HTTPS URL.";
	}
	if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
		return "OTEL_EXPORTER_OTLP_ENDPOINT must not contain a query, fragment, or credentials.";
	}
	if (/\/v1\/(?:logs|traces|metrics)\/*$/i.test(url.pathname)) {
		return "OTEL_EXPORTER_OTLP_ENDPOINT must be the collector base URL without an OTLP signal path; '/v1/logs', '/v1/traces', and '/v1/metrics' are appended automatically.";
	}
	return undefined;
};

const parseOptional = <I, A>(
	name: string,
	value: Option.Option<I>,
	parse: (value: I) => Result.Result<A, string>,
) =>
	Option.match(value, {
		onNone: () => Effect.succeed(Option.none<A>()),
		onSome: (input) => {
			const parsed = parse(input);
			return Result.isFailure(parsed)
				? Effect.fail(configError(`${name} is invalid: ${parsed.failure}.`))
				: Effect.succeed(Option.some(parsed.success));
		},
	});

const parseOtlpHeaders = (value: string): Result.Result<Record<string, string>, string> => {
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

// One cluster runner connection, two durable queue worker connections, and one application connection.
const fixedApplicationConnections = 4;

export const databaseConnectionBudget = (config: {
	readonly database: { readonly poolMax: number };
	readonly sandbox: { readonly workerConcurrency: number };
}) => {
	const application = fixedApplicationConnections + config.sandbox.workerConcurrency;
	return { application, sandboxDispatch: config.database.poolMax - application };
};

export const validateSystemConfig = (system: SystemConfigValue) =>
	Effect.gen(function* () {
		const config = yield* mapLogLevel(system);
		const limits = config.automations;
		if (
			!Number.isInteger(limits.maxDepth) ||
			limits.maxDepth < 1 ||
			limits.maxDepth > 64 ||
			!Number.isInteger(limits.maxRuns) ||
			limits.maxRuns < 1 ||
			limits.maxRuns > 10000 ||
			!Number.isInteger(limits.batchMaxItems) ||
			limits.batchMaxItems < 1 ||
			limits.batchMaxItems > 1000 ||
			!Number.isInteger(limits.retryWindowDays) ||
			limits.retryWindowDays < 1 ||
			limits.retryWindowDays > 90 ||
			!Number.isInteger(limits.historyRetentionDays) ||
			limits.historyRetentionDays < limits.retryWindowDays ||
			limits.historyRetentionDays > 365
		) {
			return yield* Effect.fail(
				configError(
					"Automation limits are out of range or history retention is shorter than the retry window.",
				),
			);
		}
		const logging = config.observability.logging;
		const otlp = config.observability.otlp;
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

		// TODO(https://github.com/better-auth/better-auth/issues/11277): OAuth sign-in
		// is broken entirely on these origins, not just unencrypted. Better Auth
		// rejects `http:` redirect URIs outside loopback with no override, so
		// `/oauth2/authorize` fails on `redirect_uri` before the flow starts. The
		// message of the commit that added this comment lists every change needed
		// once upstream exposes an opt-in override; follow it rather than
		// rediscovering the wiring.
		if (frontendUrl.protocol === "http:" && !isLoopbackOrigin(frontendUrl.origin)) {
			yield* Effect.logWarning(
				"FRONTEND_URL uses plain HTTP, so logins and API keys cross the network unencrypted and anyone on it can read them. Use HTTPS for anything reachable from the internet.",
			).pipe(Effect.annotateLogs({ frontendUrl: frontendUrl.origin }));
		}

		if (Option.isSome(otlp.endpoint)) {
			const endpointError = otlpEndpointError(otlp.endpoint.value);
			if (endpointError !== undefined) {
				return yield* Effect.fail(configError(endpointError));
			}
		}

		const headers = yield* parseOptional("OTEL_EXPORTER_OTLP_HEADERS", otlp.headers, (value) =>
			Result.map(parseOtlpHeaders(Redacted.value(value)), Redacted.make),
		);
		const egressAllowedNetworks = Option.getOrElse(
			yield* parseOptional(
				"SERVER_EGRESS_ALLOWED_NETWORKS",
				config.server.egressAllowedNetworks,
				parseEgressAllowedNetworks,
			),
			() => [],
		);

		if (logging.file.path.trim().length === 0) {
			return yield* Effect.fail(configError("SERVER_LOG_FILE must not be empty."));
		}

		if (!isValidRotationSize(logging.file.rotationSize)) {
			return yield* Effect.fail(
				configError(
					"SERVER_LOG_ROTATION_SIZE must be a positive integer followed by B, K, M, or G.",
				),
			);
		}

		if (!isValidRotationInterval(logging.file.rotationInterval)) {
			return yield* Effect.fail(
				configError(
					"SERVER_LOG_ROTATION_INTERVAL must be a supported rotation interval such as 30m, 1h, or 1d.",
				),
			);
		}

		const { clientId, issuerUrl, clientSecret } = config.server.oidc;
		const hasClientId = isNonEmpty(clientId);
		const hasIssuerUrl = isNonEmpty(issuerUrl);
		const hasClientSecret = isNonEmptyRedacted(clientSecret);
		const oidcSetCount = [hasClientId, hasIssuerUrl, hasClientSecret].filter(Boolean).length;

		if (oidcSetCount > 0 && oidcSetCount < 3) {
			return yield* Effect.fail(
				configError(
					"Partial OIDC configuration detected. Set all three of SERVER_OIDC_CLIENT_ID, SERVER_OIDC_ISSUER_URL, and SERVER_OIDC_CLIENT_SECRET, or none of them.",
				),
			);
		}

		const oidc =
			hasClientId && hasIssuerUrl && hasClientSecret
				? Option.some({
						clientId: clientId.value,
						issuerUrl: issuerUrl.value,
						clientSecret: clientSecret.value,
					})
				: Option.none();
		if (config.users.disableLocalAuth && Option.isNone(oidc)) {
			return yield* Effect.fail(
				configError(
					"USERS_DISABLE_LOCAL_AUTH is set but OIDC credentials are incomplete. Set SERVER_OIDC_CLIENT_ID, SERVER_OIDC_ISSUER_URL, and SERVER_OIDC_CLIENT_SECRET.",
				),
			);
		}

		const { user, server, password } = config.server.smtp;
		const hasServer = isNonEmpty(server);
		const hasUser = isNonEmptyRedacted(user);
		const hasPassword = isNonEmptyRedacted(password);
		const smtpSetCount = [hasServer, hasUser, hasPassword].filter(Boolean).length;
		if (smtpSetCount > 0 && smtpSetCount < 3) {
			return yield* Effect.fail(
				configError(
					"Partial SMTP configuration detected. Set all three of SERVER_SMTP_SERVER, SERVER_SMTP_USER, and SERVER_SMTP_PASSWORD, or none of them.",
				),
			);
		}
		const smtp =
			hasServer && hasUser && hasPassword
				? Option.some({
						user: user.value,
						server: server.value,
						password: password.value,
						mailbox: config.server.smtp.mailbox,
					})
				: Option.none();
		const { url, region, bucketName, accessKeyId, secretAccessKey } = config.fileStorage;
		const s3 =
			isNonEmpty(url) &&
			isNonEmpty(bucketName) &&
			isNonEmptyRedacted(accessKeyId) &&
			isNonEmptyRedacted(secretAccessKey)
				? Option.some({
						url: url.value,
						bucketName: bucketName.value,
						accessKeyId: accessKeyId.value,
						secretAccessKey: secretAccessKey.value,
						region: Option.filter(region, (value) => value.length > 0),
					})
				: Option.none();

		const permanentPath = normalizePath(config.fileStorage.localDir);
		const temporaryPath = normalizePath(config.fileStorage.localTempDir);
		if (pathsOverlap(permanentPath, temporaryPath) || pathsOverlap(temporaryPath, permanentPath)) {
			return yield* Effect.fail(
				configError("FILE_STORAGE_LOCAL_DIR and FILE_STORAGE_LOCAL_TEMP_DIR must not overlap."),
			);
		}

		const positiveIntegers = [
			["SANDBOX_WORKER_CONCURRENCY", config.sandbox.workerConcurrency],
			["SANDBOX_IMPORT_CONCURRENCY", config.sandbox.importConcurrency],
			...Option.match(config.sandbox.memoryBudgetMiB, {
				onNone: () => [],
				onSome: (value) => [["SANDBOX_MEMORY_BUDGET_MIB", value] as const],
			}),
		] as const;
		for (const [key, value] of positiveIntegers) {
			if (!(Number.isInteger(value) && value >= 1)) {
				return yield* Effect.fail(configError(`${key} (${value}) must be a positive integer.`));
			}
		}

		const { application, sandboxDispatch } = databaseConnectionBudget(config);
		if (sandboxDispatch < 1) {
			return yield* Effect.fail(
				configError(
					`DATABASE_POOL_MAX (${config.database.poolMax}) must exceed the application pool (${application} = ${fixedApplicationConnections} + SANDBOX_WORKER_CONCURRENCY ${config.sandbox.workerConcurrency}) by at least one sandbox host database dispatch connection. Raise DATABASE_POOL_MAX or lower SANDBOX_WORKER_CONCURRENCY.`,
				),
			);
		}

		return {
			...config,
			frontendUrl: frontendUrl.origin,
			server: { ...config.server, oidc, smtp, egressAllowedNetworks },
			observability: { ...config.observability, otlp: { ...otlp, headers } },
			fileStorage: {
				s3,
				localDir: config.fileStorage.localDir,
				localTempDir: config.fileStorage.localTempDir,
			},
		};
	});

export class AppConfig extends Context.Service<AppConfig>()("AppConfig", {
	make: Effect.gen(function* () {
		const system = yield* SystemConfigSource;
		return yield* validateSystemConfig(system);
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
