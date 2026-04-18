// Keep effect import comment.
import { type Logger as LoggerType, Logger } from "effect";

declare const logger: LoggerType.Logger<unknown, void>;

// Keep level comment.
const level = "Warn";
// Keep replacement comment.
const layer = Logger.layer([// Keep logger comment.
logger, Logger.tracerLogger]);

void [level, layer];
