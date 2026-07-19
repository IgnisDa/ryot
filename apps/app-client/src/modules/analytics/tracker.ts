import { Cause, Effect } from "effect";

import { TransportEnvironment } from "@/api/request-layer";
import { transportEnvironmentLive } from "@/api/transport";

import { resolveUmamiEnvironment } from "./environment";
import { umamiEndpoint, umamiRequestBody, type UmamiEvent, type UmamiSettings } from "./payload";

export const sendUmamiEvent = (options: {
	readonly event: UmamiEvent;
	readonly serverUrl: string;
	readonly settings: UmamiSettings;
}) =>
	Effect.gen(function* () {
		const { fetch } = yield* TransportEnvironment;
		const body = umamiRequestBody({
			event: options.event,
			settings: options.settings,
			environment: resolveUmamiEnvironment(options.serverUrl),
		});
		yield* Effect.tryPromise(() =>
			fetch(umamiEndpoint(options.settings.hostUrl), {
				method: "POST",
				body: JSON.stringify(body),
				headers: { "Content-Type": "application/json" },
			}),
		);
	}).pipe(
		Effect.provide(transportEnvironmentLive),
		Effect.catchCause((cause) =>
			Effect.logDebug("umami event delivery failed", Cause.pretty(cause)),
		),
	);
