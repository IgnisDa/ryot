import {
	Layer as Layers,
	Logger as Logging,
	LogLevel as Levels,
	References as Refs,
} from "effect";

declare const level: Levels.LogLevel;
declare const logger: Logging.Logger<unknown, void>;

const formatted = Logging.logfmtLogger;
const info = Levels.Info;
const compared = Levels.lessThanEqual(level, level);
const minimum = Logging.minimumLogLevel(level);
const replaced = Logging.replace(Logging.defaultLogger, logger);

void [formatted, info, compared, minimum, replaced];
