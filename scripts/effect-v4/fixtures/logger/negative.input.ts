import { Logger as EffectLogger, LogLevel as EffectLogLevel, Layer, Tracer } from "effect";

declare const entry: EffectLogger.Options<unknown>;

const local = (
	EffectLogger: { readonly replace: unknown; readonly zip: unknown },
	EffectLogLevel: { readonly Info: unknown; readonly lessThanEqual: unknown },
) => [EffectLogger.replace, EffectLogger.zip, EffectLogLevel.Info, EffectLogLevel.lessThanEqual];
const Logger = { logfmtLogger: "local", prettyLogger: "local" };
const LogLevel = { Debug: "local", Warning: "local" };
const format = EffectLogger.formatLogFmt;
const pretty = EffectLogger.consolePretty();
const tracer = EffectLogger.tracerLogger;
const deferred = [entry.logLevel.label, entry.annotations];
const layer = Layer.setTracer(Tracer.make({} as never));
const raw = "Logger.replace(Logger.defaultLogger, logger); LogLevel.Info;";
const template = String.raw`Logger.zip(left, right); LogLevel.lessThanEqual(left, right);`;

void [local, Logger, LogLevel, format, pretty, tracer, deferred, layer, raw, template];
