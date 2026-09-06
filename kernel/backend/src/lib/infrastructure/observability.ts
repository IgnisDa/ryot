import {
	Effect,
	FileSystem,
	Layer,
	Logger,
	LogLevel,
	Option,
	Path,
	Redacted,
	Result,
	Schema,
	type Context,
	Tracer,
	References,
} from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
	OtlpExporter,
	OtlpLogger,
	OtlpMetrics,
	OtlpSerialization,
	OtlpTracer,
} from "effect/unstable/observability";
import { createStream, type RotatingFileStream } from "rotating-file-stream";

import { AppConfig, type AppConfigValue, parseOtlpHeaders } from "./config/service";

const stdoutLogfmtLogger = Logger.formatLogFmt.pipe(
	Logger.map((line) => globalThis.console.log(line)),
);

export const filterLogger = <Message, Output>(
	logger: Logger.Logger<Message, Output>,
	minimumLevel: LogLevel.LogLevel,
) =>
	Logger.make<Message, Output | undefined>((options) =>
		LogLevel.isLessThanOrEqualTo(minimumLevel, options.logLevel) ? logger.log(options) : undefined,
	);

const reportFileLoggerError = (logFile: string, error: Error) =>
	globalThis.console.error(`File logger failure for '${logFile}'`, error);

class FileLoggerOpenError extends Schema.TaggedError<FileLoggerOpenError>()("FileLoggerOpenError", {
	logFile: Schema.String,
	reason: Schema.Defect(),
}) {}

const openRotatingStream = (
	logFile: string,
	logDirectory: string,
	logFileName: string,
	options: Pick<
		AppConfigValue["server"],
		"logRotationInterval" | "logRotationSize" | "logRetentionFiles"
	>,
) =>
	Effect.callback<RotatingFileStream, FileLoggerOpenError>((resume) => {
		let stream: RotatingFileStream;
		try {
			stream = createStream(logFileName, {
				compress: "gzip",
				intervalUTC: true,
				path: logDirectory,
				initialRotation: true,
				intervalBoundary: true,
				size: options.logRotationSize,
				maxFiles: options.logRetentionFiles,
				interval: options.logRotationInterval,
			});
		} catch (error) {
			resume(Effect.fail(new FileLoggerOpenError({ logFile, reason: error })));
			return Effect.void;
		}

		const onError = (error: Error) =>
			resume(Effect.fail(new FileLoggerOpenError({ logFile, reason: error })));
		stream.once("error", onError);
		stream.once("open", () => {
			stream.removeListener("error", onError);
			stream.on("error", (error) => reportFileLoggerError(logFile, error));
			stream.on("warning", (error) => reportFileLoggerError(logFile, error));
			resume(Effect.succeed(stream));
		});

		return Effect.sync(() => stream.destroy());
	});

const closeRotatingStream = (stream: RotatingFileStream) =>
	Effect.callback<void>((resume) => {
		if (stream.closed) {
			resume(Effect.void);
			return;
		}
		stream.end(() => resume(Effect.void));
	});

const writeToRotatingStream = (logFile: string, stream: RotatingFileStream, lines: Array<string>) =>
	Effect.callback<void>((resume) => {
		stream.write(`${lines.join("\n")}\n`, (error) => {
			if (error != null) {
				reportFileLoggerError(logFile, error);
			}
			resume(Effect.void);
		});
	});

const makeRotatingFileLogger = (config: AppConfigValue) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const logDirectory = path.dirname(config.server.logFile);
		yield* fs.makeDirectory(logDirectory, { recursive: true });
		const stream = yield* Effect.acquireRelease(
			openRotatingStream(
				config.server.logFile,
				logDirectory,
				path.basename(config.server.logFile),
				config.server,
			),
			closeRotatingStream,
		);
		return yield* Logger.batched(Logger.formatLogFmt, {
			window: "1 second",
			flush: (lines) => writeToRotatingStream(config.server.logFile, stream, lines),
		});
	});

const makeLoggerLayer = (config: AppConfigValue) => {
	const stdoutLogger =
		config.nodeEnv === "production" ? stdoutLogfmtLogger : Logger.consolePretty();
	return Logger.layer([
		filterLogger(stdoutLogger, "Info"),
		Effect.map(makeRotatingFileLogger(config), (logger) =>
			filterLogger(logger, config.server.logLevel),
		),
	]);
};

const decorateTracer = (tracer: Tracer.Tracer, runtime: Context.Context<never>) =>
	Tracer.make({
		...(tracer.context === undefined ? {} : { context: tracer.context.bind(tracer) }),
		span: (options) => {
			let ended = false;
			const span = tracer.span(options);
			return {
				_tag: "Span",
				kind: span.kind,
				name: span.name,
				parent: span.parent,
				spanId: span.spanId,
				traceId: span.traceId,
				sampled: span.sampled,
				annotations: span.annotations,
				get links() {
					return span.links;
				},
				get status() {
					return span.status;
				},
				addLinks: (newLinks) => span.addLinks(newLinks),
				attribute: (key, value) => span.attribute(key, value),
				get attributes() {
					return span.attributes;
				},
				event: (eventName, eventTime, attributes) => span.event(eventName, eventTime, attributes),
				end: (endTime, exit) => {
					if (!ended) {
						ended = true;
						span.end(endTime, exit);
						Effect.runForkWith(runtime)(
							Effect.logDebug("span completed").pipe(
								Effect.annotateLogs({
									spanId: span.spanId,
									traceId: span.traceId,
									spanName: options.name,
									durationMs: Number(endTime - options.startTime) / 1_000_000,
								}),
							),
						);
					}
				},
			};
		},
	});

const otlpHeaders = (headers: Option.Option<Redacted.Redacted>) =>
	Option.match(headers, {
		onNone: () => undefined,
		onSome: (value) => Result.getOrUndefined(parseOtlpHeaders(Redacted.value(value))),
	});

const makeTelemetryLayer = (config: AppConfigValue) => {
	const inner = Option.match(config.server.otlpEndpoint, {
		onNone: () => Layer.empty,
		onSome: (endpoint) => {
			const baseUrl = endpoint.replace(/\/+$/, "");
			const headers = otlpHeaders(config.server.otlpHeaders);
			const resource = {
				serviceName: "ryot-backend",
				attributes: { "deployment.environment": config.nodeEnv },
			};
			const logs = Logger.layer(
				[
					Effect.map(OtlpLogger.make({ headers, resource, url: `${baseUrl}/v1/logs` }), (logger) =>
						filterLogger(logger, config.server.logLevel),
					),
				],
				{ mergeWithExisting: true },
			);
			return Layer.mergeAll(
				logs,
				Layer.effect(
					Tracer.Tracer,
					OtlpTracer.make({ headers, resource, url: `${baseUrl}/v1/traces` }),
				),
				Layer.effectDiscard(
					OtlpMetrics.make({
						headers,
						resource,
						temporality: "cumulative",
						url: `${baseUrl}/v1/metrics`,
					}),
				),
			).pipe(
				Layer.provideMerge(OtlpExporter.layerFlusher),
				Layer.provide(Layer.mergeAll(FetchHttpClient.layer, OtlpSerialization.layerJson)),
			);
		},
	});
	if (
		Option.isNone(config.server.otlpEndpoint) ||
		!LogLevel.isLessThanOrEqualTo(config.server.logLevel, "Debug")
	) {
		return inner;
	}
	const decorator = Layer.unwrap(
		Effect.flatMap(Effect.tracer, (tracer) =>
			Effect.map(Effect.context(), (runtime) =>
				Layer.succeed(Tracer.Tracer, decorateTracer(tracer, runtime)),
			),
		),
	);
	return Layer.provideMerge(decorator, inner);
};

export const ObservabilityLive = Layer.unwrap(
	Effect.map(AppConfig, (config) => {
		const logger = makeLoggerLayer(config);
		const runtimeMinimum = LogLevel.isLessThanOrEqualTo(config.server.logLevel, "Info")
			? config.server.logLevel
			: "Info";
		const logging = Layer.mergeAll(
			Layer.succeed(References.MinimumLogLevel, runtimeMinimum),
			logger,
		);
		const telemetry = makeTelemetryLayer(config).pipe(Layer.provide(logging));
		return Layer.mergeAll(logging, telemetry);
	}),
);
