import { Effect, Layer, Logger, LogLevel, Option, type Context, Tracer } from "effect";

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
			Logger.toFile(logFile.value, { flag: "a" }),
			Effect.map((fileLogger) => Logger.zip(stdoutLogger, fileLogger)),
		),
	);
};

const makeTracerLayer = (logLevel: LogLevel.LogLevel, runtime: Context.Context<never>) => {
	if (!LogLevel.lessThanEqual(logLevel, LogLevel.Debug)) {
		return Layer.empty;
	}
	return Layer.setTracer(Tracer.make({ context: runtime } as never));
};

declare const entry: Logger.Options<unknown>;
declare const configuredLevel: LogLevel.LogLevel;

const logging = Layer.mergeAll(Logger.minimumLogLevel(configuredLevel), makeLoggerLayer("test", Option.none()));
const deferred = [entry.logLevel.label, entry.annotations];
const retained = Logger.tracerLogger;

void [logging, deferred, retained, makeTracerLayer];
