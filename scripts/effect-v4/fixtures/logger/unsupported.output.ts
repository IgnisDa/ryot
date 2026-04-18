import { Logger, LogLevel } from "effect";

declare const logger: Logger.Logger<unknown, void>;

const supported = LogLevel.Info;
const unsupported = Logger["replace"](Logger.defaultLogger, logger);

void [supported, unsupported];
