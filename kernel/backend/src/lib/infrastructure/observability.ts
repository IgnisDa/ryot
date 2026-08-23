import {
	Effect,
	Layer,
	Logger,
	LogLevel,
	Option,
	Redacted,
	Result,
	type Context,
	Tracer,
	References,
} from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

import { AppConfig, type AppConfigValue, parseOtlpHeaders } from "./config/service";

const stdoutLogfmtLogger = Logger.formatLogFmt.pipe(
	Logger.map((line) => globalThis.console.log(line)),
);

const makeLoggerLayer = (nodeEnv: string, logFile: Option.Option<string>) => {
	const stdoutLogger = nodeEnv === "production" ? stdoutLogfmtLogger : Logger.consolePretty();
	if (Option.isNone(logFile)) {
		return Logger.layer([stdoutLogger, Logger.tracerLogger]);
	}
	return Logger.layer([
		Logger.formatLogFmt.pipe(
			Logger.toFile(logFile.value, { flag: "a" }),
			Effect.map((fileLogger) =>
				Logger.make((options) => [stdoutLogger.log(options), fileLogger.log(options)]),
			),
		),
		Logger.tracerLogger,
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

const makeTracerLayer = (config: AppConfigValue) => {
	const inner = Option.match(config.server.otlpEndpoint, {
		onNone: () => Layer.empty,
		onSome: (baseUrl) =>
			OtlpTracer.layer({
				headers: otlpHeaders(config.server.otlpHeaders),
				url: `${baseUrl.replace(/\/+$/, "")}/v1/traces`,
				resource: {
					serviceName: "ryot-backend",
					attributes: { "deployment.environment": config.nodeEnv },
				},
			}).pipe(Layer.provide(Layer.mergeAll(FetchHttpClient.layer, OtlpSerialization.layerJson))),
	});
	if (!LogLevel.isLessThanOrEqualTo(config.server.logLevel, "Debug")) {
		return inner;
	}
	const decorator = Layer.unwrap(
		Effect.flatMap(Effect.tracer, (tracer) =>
			Effect.map(Effect.context(), (runtime) =>
				Layer.succeed(Tracer.Tracer, decorateTracer(tracer, runtime)),
			),
		),
	);
	return Layer.provide(decorator, inner);
};

export const ObservabilityLive = Layer.unwrap(
	Effect.map(AppConfig, (config) => {
		const logger = makeLoggerLayer(config.nodeEnv, config.server.logFile);
		const logging = Layer.mergeAll(
			Layer.succeed(References.MinimumLogLevel, config.server.logLevel),
			logger,
		);
		const tracer = makeTracerLayer(config).pipe(Layer.provide(logging));
		return Layer.mergeAll(logging, tracer);
	}),
);
