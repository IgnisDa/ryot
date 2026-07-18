import {
	Layer as Layers,
	Logger as Logging,
	LogLevel as Levels,
	References as Refs,
} from "effect";

declare const level: Levels.LogLevel;
declare const logger: Logging.Logger<unknown, void>;

const formatted = Logging.formatLogFmt;
const info = "Info";
const compared = Levels.isLessThanOrEqualTo(level, level);
const minimum = Layers.succeed(Refs.MinimumLogLevel, level);
const replaced = Logging.layer([logger, Logging.tracerLogger]);

void [formatted, info, compared, minimum, replaced];
