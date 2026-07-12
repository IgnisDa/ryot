import { Effect, Layer, Logger, LogLevel, Option, type Context, Tracer, References } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

import { AppConfig } from "./config/service";

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
				attribute: (key, value) => span.attribute(key, value),
				addLinks: (newLinks) => span.addLinks(newLinks),
				event: (eventName, eventTime, attributes) => span.event(eventName, eventTime, attributes),
				get status() {
					return span.status;
				},
				get attributes() {
					return span.attributes;
				},
				get links() {
					return span.links;
				},
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

const makeTracerLayer = (endpoint: Option.Option<string>, logLevel: LogLevel.LogLevel) => {
	const inner = Option.match(endpoint, {
		onNone: () => Layer.empty,
		onSome: (baseUrl) =>
			OtlpTracer.layer({
				url: `${baseUrl.replace(/\/+$/, "")}/v1/traces`,
				resource: { serviceName: "ryot-backend" },
			}).pipe(Layer.provide(Layer.mergeAll(FetchHttpClient.layer, OtlpSerialization.layerJson))),
	});
	if (!LogLevel.isLessThanOrEqualTo(logLevel, "Debug")) {
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
		const tracer = makeTracerLayer(config.server.otlpEndpoint, config.server.logLevel).pipe(
			Layer.provide(logging),
		);
		return Layer.mergeAll(logging, tracer);
	}),
);
