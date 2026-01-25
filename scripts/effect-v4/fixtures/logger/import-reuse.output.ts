import { Effect, Layer, Logger, References, type Scope } from "effect";

declare const level: "Info";

const info = "Info";
const minimum = Layer.succeed(References.MinimumLogLevel, level);

const local = (LogLevel: { readonly Info: string }) => LogLevel.Info;

void [Effect, Layer, References, info, minimum, local];
void (0 as unknown as Scope.Scope);
