import { Layer as Layers, Logger, References as Refs } from "effect";

declare const Layer: { readonly local: true };
declare const References: { readonly local: true };
declare const level: "Info";

const minimum = ((Layers: unknown, Refs: unknown) => Logger.minimumLogLevel(level))(
	Layer,
	References,
);

void [Layers, Refs, minimum];
