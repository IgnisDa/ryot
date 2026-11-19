import * as Context from "effect/Context";
import { SecureRandom } from "effect/crypto";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import type { RyotClient } from "../client/client";
import type { PluginRouterNavigation } from "../navigation/store";
import { RyotScheduleService } from "../schedule";

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

type ScheduleLayer = Layer.Layer<RyotScheduleService, never, SecureRandom.SecureRandom>;

export class RyotClientService extends Context.Service<RyotClientService, RyotClient>()(
	"@ryot-app/plugin-client-sdk/runtime/runtime/RyotClientService",
) {
	static readonly layer = (client: RyotClient) => Layer.succeed(this, client);
}

export class RyotNavigationService extends Context.Service<
	RyotNavigationService,
	PluginRouterNavigation
>()("@ryot-app/plugin-client-sdk/runtime/runtime/RyotNavigationService") {
	static readonly layer = (navigation: PluginRouterNavigation) => Layer.succeed(this, navigation);
}

const makeRyotLayer = (client: RyotClient, schedule: ScheduleLayer) =>
	Layer.mergeAll(RyotClientService.layer(client), schedule);

export const makeRyotPluginLayer = (
	client: RyotClient,
	navigation: PluginRouterNavigation,
	schedule: ScheduleLayer,
) => Layer.mergeAll(makeRyotLayer(client, schedule), RyotNavigationService.layer(navigation));

export const makeRyotRuntime = (client: RyotClient): RyotRuntime =>
	ManagedRuntime.make(
		makeRyotLayer(client, RyotScheduleService.layer).pipe(
			Layer.provide(SecureRandom.layerWebCrypto),
		),
	);

export const makeRyotPluginRuntime = (
	client: RyotClient,
	navigation: PluginRouterNavigation,
): RyotPluginRuntime =>
	ManagedRuntime.make(
		makeRyotPluginLayer(client, navigation, RyotScheduleService.layer).pipe(
			Layer.provide(SecureRandom.layerWebCrypto),
		),
	);
