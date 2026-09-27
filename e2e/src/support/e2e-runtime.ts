import { BunPath } from "@effect/platform-bun";
import { clientPluginCompilerPlatformLayer } from "@ryot-app/client-plugin-compiler";
import { sandboxCompilerPlatformLayer } from "@ryot-app/sandbox-compiler/platform";
import { Effect, Layer } from "effect";
import { chromium, PlaywrightSpawner } from "effect-playwright";
import { FetchHttpClient } from "effect/http";

const e2eLayer = Layer.mergeAll(
	BunPath.layer,
	FetchHttpClient.layer,
	PlaywrightSpawner.layer(chromium),
	sandboxCompilerPlatformLayer,
	clientPluginCompilerPlatformLayer,
);

export type E2eServices = Layer.Success<typeof e2eLayer>;

export const provideE2eServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	// oxlint-disable-next-line effecttsgo/strict-effect-provide -- E2E tests, hooks, and scripts are the runtime entrypoints
	Effect.provide(effect, e2eLayer);

export const runPromise = <A, E>(effect: Effect.Effect<A, E, E2eServices>) =>
	Effect.runPromise(provideE2eServices(effect));
