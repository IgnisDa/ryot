// Keep effect import comment.
import { type Logger as LoggerType, Logger, LogLevel } from "effect";

declare const logger: LoggerType.Logger<unknown, void>;

// Keep level comment.
const level = LogLevel.Warning;
// Keep replacement comment.
const layer = Logger.replace(
	Logger.defaultLogger,
	// Keep logger comment.
	logger,
);

void [level, layer];
