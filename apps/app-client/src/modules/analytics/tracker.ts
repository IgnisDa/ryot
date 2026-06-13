import { Cause, Effect } from "effect";

import { TransportEnvironment } from "@/api/request-layer";
import { transportEnvironmentLive } from "@/api/transport";

import { resolveUmamiEnvironment } from "./environment";
import {
	umamiEndpoint,
	umamiRequestBody,
	type UmamiCollectionType,
	type UmamiEvent,
	type UmamiSettings,
} from "./payload";

export const sendUmamiEvent = (options: {
	readonly event: UmamiEvent;
	readonly serverUrl: string;
	readonly distinctId?: string;
	readonly settings: UmamiSettings;
	readonly type?: UmamiCollectionType;
}) =>
	Effect.gen(function* () {
		const { fetch } = yield* TransportEnvironment;
		const body = umamiRequestBody({
			type: options.type,
			event: options.event,
			settings: options.settings,
			distinctId: options.distinctId,
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
