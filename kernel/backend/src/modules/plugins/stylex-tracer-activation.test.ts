import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";

import { StyleXTracerActivation, StyleXTracerActivationLive } from "./stylex-tracer-activation";

const activationFrom = (environment: Record<string, string>) =>
	StyleXTracerActivation.pipe(
		Effect.provide(StyleXTracerActivationLive),
		Effect.provideService(
			ConfigProvider.ConfigProvider,
			ConfigProvider.fromEnv({ env: environment }),
		),
	);

it.effect("enables the tracer only for RYOT_STYLEX_TRACER=1", () =>
	Effect.gen(function* () {
		expect((yield* activationFrom({})).enabled).toBe(false);
		expect((yield* activationFrom({ RYOT_STYLEX_TRACER: "true" })).enabled).toBe(false);
		expect((yield* activationFrom({ RYOT_STYLEX_TRACER: "1" })).enabled).toBe(true);
	}),
);
