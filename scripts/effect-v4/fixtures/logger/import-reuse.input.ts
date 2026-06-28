import { Effect, Layer, Logger, LogLevel, References, type Scope } from "effect";

declare const level: "Info";

const info = LogLevel.Info;
const minimum = Logger.minimumLogLevel(level);

const local = (LogLevel: { readonly Info: string }) => LogLevel.Info;

void [Effect, Layer, References, info, minimum, local];
void (0 as unknown as Scope.Scope);
