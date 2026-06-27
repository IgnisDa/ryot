import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import type { RyotClient } from "./index";
import type { PluginRouterNavigation } from "./navigation/store";

// Deep `effect/*` imports only: the plugin bundler replaces the bare `effect` barrel with a
// six-export shim, so `import { Clock } from "effect"` would resolve to nothing at runtime.

/** Plugin-facing shape: plain callbacks, no Effect types. */
export type RyotSchedule = {
	readonly now: () => number;
	readonly after: (delayMs: number, run: () => void) => () => void;
};

export class RyotClientService extends Context.Service<RyotClientService, RyotClient>()(
	"RyotClientService",
) {
	static readonly layer = (client: RyotClient) => Layer.succeed(this, client);
}

export class RyotScheduleService extends Context.Service<RyotScheduleService, RyotSchedule>()(
	"RyotScheduleService",
) {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const clock = yield* Clock.Clock;
			const scope = yield* Effect.scope;
			// Captured so forked sleeps run on this layer's clock. A bare `Effect.runFork` would fork
			// on the global runtime and silently use the live clock, defeating `TestClock`.
			const runCallback = Effect.runCallbackWith(yield* Effect.context());
			return {
				now: () => clock.currentTimeMillisUnsafe(),
				after: (delayMs: number, run: () => void) => {
					const interrupt = runCallback(Effect.andThen(Effect.sleep(delayMs), Effect.sync(run)), {
						// Ties the pending sleep to the layer scope, so disposing the runtime interrupts it.
						onFiberStart: Fiber.runIn(scope),
						onExit: (exit) => {
							if (Exit.isFailure(exit) && !Cause.hasInterrupts(exit.cause)) {
								// Preserves the plugin fatal path: a throw inside the callback must reach the
								// window `error` listener that calls `runtime.fatal()`.
								const error = Cause.squash(exit.cause);
								queueMicrotask(() => {
									throw error;
								});
							}
						},
					});
					return () => interrupt();
				},
			};
		}),
	);
}

export class RyotNavigationService extends Context.Service<
	RyotNavigationService,
	PluginRouterNavigation
>()("RyotNavigationService") {
	static readonly layer = (navigation: PluginRouterNavigation) => Layer.succeed(this, navigation);
}

export type RyotRuntime = ManagedRuntime.ManagedRuntime<
	RyotClientService | RyotScheduleService,
	never
>;

/**
 * A plugin artifact's runtime. Only an artifact owns a `PluginRouter`, so only this runtime carries
 * `RyotNavigationService`; the kernel host builds the narrower `RyotRuntime`.
 */
export type RyotPluginRuntime = ManagedRuntime.ManagedRuntime<
	RyotClientService | RyotScheduleService | RyotNavigationService,
	never
>;

export const makeRyotRuntime = (client: RyotClient): RyotRuntime =>
	ManagedRuntime.make(Layer.mergeAll(RyotClientService.layer(client), RyotScheduleService.layer));

export const makeRyotPluginRuntime = (
	client: RyotClient,
	navigation: PluginRouterNavigation,
): RyotPluginRuntime =>
	ManagedRuntime.make(
		Layer.mergeAll(
			RyotClientService.layer(client),
			RyotScheduleService.layer,
			RyotNavigationService.layer(navigation),
		),
	);

type BootstrapRyotRuntimeFactory = (
	client: RyotClient,
	navigation: PluginRouterNavigation,
) => RyotPluginRuntime;

let bootstrapRuntimeFactory: BootstrapRyotRuntimeFactory = makeRyotPluginRuntime;

/**
 * Internal test seam. `testing.ts` swaps in a `TestClock`-backed runtime so `bootstrapClientPage`
 * and `bootstrapClientPlugin` can be driven by a test clock. Never re-exported through `./plugin`.
 */
export const setBootstrapRyotRuntimeFactory = (
	factory: BootstrapRyotRuntimeFactory | undefined,
) => {
	bootstrapRuntimeFactory = factory ?? makeRyotPluginRuntime;
};

export const createBootstrapRyotRuntime: BootstrapRyotRuntimeFactory = (client, navigation) =>
	bootstrapRuntimeFactory(client, navigation);
