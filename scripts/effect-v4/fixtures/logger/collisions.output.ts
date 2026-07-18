import {
    Layer as Layers,
    Logger,
    References as Refs,
    Layer as EffectLayer,
    References as EffectReferences,
} from "effect";

declare const Layer: { readonly local: true };
declare const References: { readonly local: true };
declare const level: "Info";

const minimum = ((Layers: unknown, Refs: unknown) => EffectLayer.succeed(EffectReferences.MinimumLogLevel, level))(
	Layer,
	References,
);

void [Layers, Refs, minimum];
