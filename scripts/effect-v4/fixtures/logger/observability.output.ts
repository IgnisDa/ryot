import { Effect, Layer, Logger, LogLevel, Option, type Context, Tracer, References } from "effect";

const stdoutLogfmtLogger = Logger.formatLogFmt.pipe(
	Logger.map((line) => globalThis.console.log(line)),
);

const makeLoggerLayer = (nodeEnv: string, logFile: Option.Option<string>) => {
	const stdoutLogger = nodeEnv === "production" ? stdoutLogfmtLogger : Logger.consolePretty();
	if (Option.isNone(logFile)) {
		return Logger.layer([stdoutLogger, Logger.tracerLogger]);
	}
	return Logger.layer([Logger.formatLogFmt.pipe(
        Logger.toFile(logFile.value, { flag: "a" }),
        Effect.map((fileLogger) => Logger.make((options) => [stdoutLogger.log(options), fileLogger.log(options)])),
    ), Logger.tracerLogger]);
};

const makeTracerLayer = (logLevel: LogLevel.LogLevel, runtime: Context.Context<never>) => {
	if (!LogLevel.isLessThanOrEqualTo(logLevel, "Debug")) {
		return Layer.empty;
	}
	return Layer.setTracer(Tracer.make({ context: runtime } as never));
};

declare const entry: Logger.Options<unknown>;
declare const configuredLevel: LogLevel.LogLevel;

const logging = Layer.mergeAll(Layer.succeed(References.MinimumLogLevel, configuredLevel), makeLoggerLayer("test", Option.none()));
const deferred = [entry.logLevel.label, entry.annotations];
const retained = Logger.tracerLogger;

void [logging, deferred, retained, makeTracerLayer];
