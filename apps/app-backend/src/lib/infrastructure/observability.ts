import * as OtlpSerialization from "@effect/opentelemetry/OtlpSerialization";
import * as OtlpTracer from "@effect/opentelemetry/OtlpTracer";
import { FetchHttpClient, PlatformLogger } from "@effect/platform";
import { Effect, Layer, Logger, LogLevel, Option, Runtime, Tracer } from "effect";

import { AppConfig } from "./config/service";

const stdoutLogfmtLogger = Logger.logfmtLogger.pipe(
	Logger.map((line) => globalThis.console.log(line)),
);

const makeLoggerLayer = (nodeEnv: string, logFile: Option.Option<string>) => {
	const stdoutLogger = nodeEnv === "production" ? stdoutLogfmtLogger : Logger.prettyLogger();
	if (Option.isNone(logFile)) {
		return Logger.replace(Logger.defaultLogger, stdoutLogger);
	}
	return Logger.replaceScoped(
		Logger.defaultLogger,
		Logger.logfmtLogger.pipe(
			PlatformLogger.toFile(logFile.value, { flag: "a" }),
			Effect.map((fileLogger) => Logger.zip(stdoutLogger, fileLogger)),
		),
	);
};

const decorateTracer = (tracer: Tracer.Tracer, runtime: Runtime.Runtime<never>) =>
	Tracer.make({
		context: (evaluate, fiber) => tracer.context(evaluate, fiber),
		span: (name, parent, context, links, startTime, kind, options) => {
			let ended = false;
			const span = tracer.span(name, parent, context, links, startTime, kind, options);
			return {
				_tag: "Span",
				name: span.name,
				kind: span.kind,
				parent: span.parent,
				spanId: span.spanId,
				traceId: span.traceId,
				context: span.context,
				sampled: span.sampled,
				addLinks: (newLinks) => span.addLinks(newLinks),
				attribute: (key, value) => span.attribute(key, value),
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
						Runtime.runFork(runtime)(
							Effect.logDebug("span completed").pipe(
								Effect.annotateLogs({
									spanName: name,
									spanId: span.spanId,
									traceId: span.traceId,
									durationMs: Number(endTime - startTime) / 1_000_000,
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
	if (!LogLevel.lessThanEqual(logLevel, LogLevel.Debug)) {
		return inner;
	}
	const decorator = Layer.unwrapEffect(
		Tracer.tracerWith((tracer) =>
			Effect.map(Effect.runtime(), (runtime) => Layer.setTracer(decorateTracer(tracer, runtime))),
		),
	);
	return Layer.provide(decorator, inner);
};

export const ObservabilityLive = Layer.unwrapEffect(
	Effect.map(AppConfig, (config) => {
		const logger = makeLoggerLayer(config.nodeEnv, config.server.logFile);
		const logging = Layer.mergeAll(Logger.minimumLogLevel(config.server.logLevel), logger);
		const tracer = makeTracerLayer(config.server.otlpEndpoint, config.server.logLevel).pipe(
			Layer.provide(logging),
		);
		return Layer.mergeAll(logging, tracer);
	}),
);
