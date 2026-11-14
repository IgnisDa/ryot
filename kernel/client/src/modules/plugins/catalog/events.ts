import {
	PLUGIN_CATALOG_CONNECTED_EVENT,
	PLUGIN_CATALOG_INVALIDATED_EVENT,
} from "@ryot-app/contract/modules/plugins/contract";
import { Context, Duration, Effect, Layer, Schedule } from "effect";

import {
	EventStreamClosed,
	type EventStreamFactory,
	fetchEventStream,
	openEventStream,
} from "#/api/event-stream";
import { serverApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { OAuthTokenService } from "#/modules/auth/token-service";

const RECONNECT_CAP = Duration.seconds(30);

const reconnectSchedule = Schedule.exponential("1 second").pipe(
	Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, RECONNECT_CAP))),
	Schedule.jittered,
);

const makePluginCatalogEventsService = (
	tokens: OAuthTokenService["Service"],
	open: EventStreamFactory,
	reconnect: Schedule.Schedule<unknown>,
) => ({
	subscribe: (scope: ApiScope, onCatalogChanged: () => void) => {
		const url = `${serverApiUrl(scope.serverUrl)}/plugins/events`;
		const onEvent = (type: string) => {
			if (type === PLUGIN_CATALOG_INVALIDATED_EVENT || type === PLUGIN_CATALOG_CONNECTED_EVENT) {
				onCatalogChanged();
			}
		};

		const connect = (forceRefresh: boolean) =>
			Effect.gen(function* () {
				const token = yield* tokens.accessToken(scope.serverUrl, forceRefresh);
				if (token === null) {
					return yield* Effect.never;
				}
				const unauthorized = yield* openEventStream(open, url, token, onEvent);
				if (!unauthorized) {
					return yield* new EventStreamClosed({ cause: "stream ended" });
				}
				return unauthorized;
			});

		return Effect.gen(function* () {
			if (yield* connect(false)) {
				yield* connect(true);
			}
			return yield* Effect.never;
		}).pipe(Effect.retry(reconnect), Effect.orDie);
	},
});

export class PluginCatalogEventsService extends Context.Service<
	PluginCatalogEventsService,
	{ readonly subscribe: (scope: ApiScope, onCatalogChanged: () => void) => Effect.Effect<never> }
>()("@ryot-app/kernel-client/modules/plugins/catalog/events/PluginCatalogEventsService") {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			return makePluginCatalogEventsService(
				yield* OAuthTokenService,
				fetchEventStream,
				reconnectSchedule,
			);
		}),
	);
}

export const makePluginCatalogEventsLayer = (
	open: EventStreamFactory,
	reconnect: Schedule.Schedule<unknown> = reconnectSchedule,
) =>
	Layer.effect(
		PluginCatalogEventsService,
		Effect.gen(function* () {
			return makePluginCatalogEventsService(yield* OAuthTokenService, open, reconnect);
		}),
	);
