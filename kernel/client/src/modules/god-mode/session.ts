import { Context, Effect, Layer } from "effect";

import type { ServerOrigin } from "#/api/origin";

export type GodModeSession = { readonly token: string; readonly origin: ServerOrigin };

export type GodModeSessionServiceShape = {
	readonly clear: (sessionId: string) => Effect.Effect<void>;
	readonly get: (sessionId: string) => Effect.Effect<GodModeSession | null>;
	readonly create: (origin: ServerOrigin, token: string) => Effect.Effect<string>;
};

export const makeGodModeSessionService = (
	randomSessionId: () => string = () => crypto.randomUUID(),
): GodModeSessionServiceShape => {
	const sessions = new Map<string, GodModeSession>();

	return {
		get: (sessionId) => Effect.sync(() => sessions.get(sessionId) ?? null),
		clear: (sessionId) =>
			Effect.sync(() => {
				sessions.delete(sessionId);
			}),
		create: (origin, token) =>
			Effect.sync(() => {
				let sessionId = randomSessionId();
				while (sessions.has(sessionId)) {
					sessionId = randomSessionId();
				}
				sessions.set(sessionId, { token, origin });
				return sessionId;
			}),
	};
};

export class GodModeSessionService extends Context.Service<
	GodModeSessionService,
	GodModeSessionServiceShape
>()("GodModeSessionService", { make: Effect.sync(makeGodModeSessionService) }) {
	static readonly layer = Layer.effect(this, this.make);
}
