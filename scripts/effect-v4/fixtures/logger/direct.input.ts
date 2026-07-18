import { Logger, LogLevel } from "effect";

declare const level: LogLevel.LogLevel;
declare const leftLogger: Logger.Logger<unknown, string>;
declare const rightLogger: Logger.Logger<unknown, number>;
declare const loggerEffect: unknown;

const levels = [
	LogLevel.All,
	LogLevel.Debug,
	LogLevel.Error,
	LogLevel.Fatal,
	LogLevel.Info,
	LogLevel.None,
	LogLevel.Trace,
	LogLevel.Warning,
];
const compared = LogLevel.lessThanEqual(level, level);
const formatted = Logger.logfmtLogger;
const pretty = Logger.prettyLogger();
const minimum = Logger.minimumLogLevel(level);
const replaced = Logger.replace(Logger.defaultLogger, leftLogger);
const scoped = Logger.replaceScoped(Logger.defaultLogger, loggerEffect);
const zipped = Logger.zip(leftLogger, rightLogger);

type Level = LogLevel.LogLevel;

void [levels, compared, formatted, pretty, minimum, replaced, scoped, zipped];
void (0 as unknown as Level);
