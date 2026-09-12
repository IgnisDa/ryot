import { notFound } from "@ryot-app/contract/errors";
import type { EntityInterestEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-interest/messages";
import { Context, Effect, Layer } from "effect";

export type LocalInterestSessionEnqueue = (message: EntityInterestEntityUpdatedMessage) => void;
type LocalInterestSessionRevocation = {
	readonly authSessionId: string;
	readonly close: () => Effect.Effect<void>;
};

type LocalInterestSession = {
	readonly enqueue: LocalInterestSessionEnqueue;
	readonly revocation?: LocalInterestSessionRevocation;
};

export class LocalInterestSessions extends Context.Service<LocalInterestSessions>()(
	"LocalInterestSessions",
	{
		make: Effect.sync(() => {
			const sessions = new Map<string, LocalInterestSession>();
			const add = (
				sessionId: string,
				enqueue: LocalInterestSessionEnqueue,
				revocation?: LocalInterestSessionRevocation,
			) =>
				Effect.sync(() => {
					if (sessions.has(sessionId)) {
						return false;
					}
					sessions.set(sessionId, { enqueue, ...(revocation === undefined ? {} : { revocation }) });
					return true;
				}).pipe(
					Effect.flatMap((claimed) =>
						claimed ? Effect.void : Effect.fail(notFound("Unknown session")),
					),
				);
			const remove = (sessionId: string, enqueue: LocalInterestSessionEnqueue) =>
				Effect.sync(() => {
					if (sessions.get(sessionId)?.enqueue === enqueue) {
						sessions.delete(sessionId);
					}
				});
			const enqueue = (sessionId: string, message: EntityInterestEntityUpdatedMessage) =>
				Effect.sync(() => sessions.get(sessionId)?.enqueue(message));
			const closeAuthSession = Effect.fn("LocalInterestSessions.closeAuthSession")(function* (
				authSessionId: string,
			) {
				const closeCallbacks = yield* Effect.sync(() =>
					[...sessions.values()]
						.filter((session) => session.revocation?.authSessionId === authSessionId)
						.map((session) => session.revocation?.close)
						.filter((close): close is () => Effect.Effect<void> => close !== undefined),
				);
				yield* Effect.forEach(closeCallbacks, (close) => close(), { discard: true });
			});

			return { add, remove, enqueue, closeAuthSession };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
