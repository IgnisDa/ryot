import { Logger, LogLevel, Layer, References } from "effect";

declare const level: LogLevel.LogLevel;
declare const leftLogger: Logger.Logger<unknown, string>;
declare const rightLogger: Logger.Logger<unknown, number>;
declare const loggerEffect: unknown;

const levels = [
	"All",
	"Debug",
	"Error",
	"Fatal",
	"Info",
	"None",
	"Trace",
	"Warn",
];
const compared = LogLevel.isLessThanOrEqualTo(level, level);
const formatted = Logger.formatLogFmt;
const pretty = Logger.consolePretty();
const minimum = Layer.succeed(References.MinimumLogLevel, level);
const replaced = Logger.layer([leftLogger, Logger.tracerLogger]);
const scoped = Logger.layer([loggerEffect, Logger.tracerLogger]);
const zipped = Logger.make((options) => [leftLogger.log(options), rightLogger.log(options)]);

type Level = LogLevel.LogLevel;

void [levels, compared, formatted, pretty, minimum, replaced, scoped, zipped];
void (0 as unknown as Level);
