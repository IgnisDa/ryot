import { STYLEX_TRACER_BUILD_FINGERPRINT } from "@ryot-app/client-plugin-compiler";
import { Config, Context, Effect, Layer } from "effect";

type StyleXTracerActivationValue = { readonly enabled: boolean; readonly fingerprint: string };

export const styleXTracerDisabled: StyleXTracerActivationValue = {
	enabled: false,
	fingerprint: STYLEX_TRACER_BUILD_FINGERPRINT,
};

export class StyleXTracerActivation extends Context.Service<StyleXTracerActivation>()(
	"StyleXTracerActivation",
	{ make: Effect.succeed(styleXTracerDisabled) },
) {}

export const styleXTracerActivationLayer = (
	enabled: boolean,
	fingerprint = STYLEX_TRACER_BUILD_FINGERPRINT,
) => Layer.succeed(StyleXTracerActivation, StyleXTracerActivation.of({ enabled, fingerprint }));

export const StyleXTracerActivationLive = Layer.effect(
	StyleXTracerActivation,
	Config.string("RYOT_STYLEX_TRACER").pipe(
		Config.withDefault(""),
		Effect.map((value) => ({
			enabled: value === "1",
			fingerprint: STYLEX_TRACER_BUILD_FINGERPRINT,
		})),
		Effect.map(StyleXTracerActivation.of),
	),
);
