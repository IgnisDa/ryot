import {
	LIVE_UPDATES_CONNECTED_EVENT,
	LiveUpdateFrame,
	type PopulateEntitiesBody,
} from "@ryot-app/contract/modules/live-updates/messages";
import { Context, Effect, Layer, Option, Schema } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import {
	EventStreamClosed,
	type EventStreamFactory,
	fetchEventStream,
	openEventStream,
} from "#/api/event-stream";
import { serverApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { OAuthTokenService } from "#/modules/auth/token-service";

const decodeFrame = Schema.decodeUnknownOption(Schema.fromJsonString(LiveUpdateFrame));

export type LiveUpdateListeners = {
	readonly onConnected: () => void;
	readonly onFrame: (frame: LiveUpdateFrame) => void;
};

const makeLiveUpdatesApi = (
	api: AuthenticatedApi["Service"],
	tokens: OAuthTokenService["Service"],
	open: EventStreamFactory,
) => ({
	populate: (scope: ApiScope, payload: PopulateEntitiesBody) =>
		api.run(scope, (client) => client.entities.populate({ payload })),
	/** Follows one connection until it ends, which is always a failure for the caller to retry. */
	events: (scope: ApiScope, listeners: LiveUpdateListeners) => {
		const url = `${serverApiUrl(scope.serverUrl)}/events`;
		const onEvent = (type: string, data: string) => {
			if (type === LIVE_UPDATES_CONNECTED_EVENT) {
				listeners.onConnected();
				return;
			}
			Option.map(decodeFrame(data), listeners.onFrame);
		};
		const connect = (forceRefresh: boolean) =>
			Effect.gen(function* () {
				const token = yield* tokens.accessToken(scope.serverUrl, forceRefresh);
				if (token === null) {
					return yield* Effect.never;
				}
				return yield* openEventStream(open, url, token, onEvent);
			});
		return Effect.gen(function* () {
			if (yield* connect(false)) {
				yield* connect(true);
			}
			return yield* new EventStreamClosed({ cause: "event stream ended" });
		});
	},
});

export class LiveUpdatesApi extends Context.Service<
	LiveUpdatesApi,
	ReturnType<typeof makeLiveUpdatesApi>
>()("@ryot-app/kernel-client/api/live-updates/LiveUpdatesApi") {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			return makeLiveUpdatesApi(
				yield* AuthenticatedApi,
				yield* OAuthTokenService,
				fetchEventStream,
			);
		}),
	);
}
