import { Context, Effect, Layer } from "effect";

import type { ServerOrigin } from "#/api/origin";

export type InstanceAdminSession = { readonly token: string; readonly origin: ServerOrigin };

export type InstanceAdminSessionServiceShape = {
	readonly clear: (sessionId: string) => Effect.Effect<void>;
	readonly get: (sessionId: string) => Effect.Effect<null | InstanceAdminSession>;
	readonly create: (origin: ServerOrigin, token: string) => Effect.Effect<string>;
};

export const makeInstanceAdminSessionService = (
	randomSessionId: () => string = () => crypto.randomUUID(),
): InstanceAdminSessionServiceShape => {
	const sessions = new Map<string, InstanceAdminSession>();

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

export class InstanceAdminSessionService extends Context.Service<
	InstanceAdminSessionService,
	InstanceAdminSessionServiceShape
>()("InstanceAdminSessionService", { make: Effect.sync(makeInstanceAdminSessionService) }) {
	static readonly layer = Layer.effect(this, this.make);
}
