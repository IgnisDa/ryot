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

/** Clock-backed scheduling and scoped execution for client work. */
export type RyotSchedule = {
	readonly now: () => number;
	readonly after: (delayMs: number, run: () => void) => () => void;
	readonly run: (work: Effect.Effect<void>, onExit: () => void) => () => void;
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
				run: (work, onExit) =>
					runCallback(work, { onExit: () => onExit(), onFiberStart: Fiber.runIn(scope) }),
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

const makeRyotLayer = (client: RyotClient, schedule: Layer.Layer<RyotScheduleService>) =>
	Layer.mergeAll(RyotClientService.layer(client), schedule);

export const makeRyotPluginLayer = (
	client: RyotClient,
	navigation: PluginRouterNavigation,
	schedule: Layer.Layer<RyotScheduleService>,
) => Layer.mergeAll(makeRyotLayer(client, schedule), RyotNavigationService.layer(navigation));

export const makeRyotRuntime = (client: RyotClient): RyotRuntime =>
	ManagedRuntime.make(makeRyotLayer(client, RyotScheduleService.layer));

export const makeRyotPluginRuntime = (
	client: RyotClient,
	navigation: PluginRouterNavigation,
): RyotPluginRuntime =>
	ManagedRuntime.make(makeRyotPluginLayer(client, navigation, RyotScheduleService.layer));
