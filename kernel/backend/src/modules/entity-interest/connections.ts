import { notFound } from "@ryot-app/contract/errors";
import type { EntityInterestEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-interest/messages";
import { Context, Effect, Layer } from "effect";

export type LocalInterestSessionEnqueue = (message: EntityInterestEntityUpdatedMessage) => void;

export class LocalInterestSessions extends Context.Service<LocalInterestSessions>()(
	"LocalInterestSessions",
	{
		make: Effect.sync(() => {
			const sessions = new Map<string, LocalInterestSessionEnqueue>();
			const add = (sessionId: string, enqueue: LocalInterestSessionEnqueue) =>
				Effect.sync(() => {
					if (sessions.has(sessionId)) {
						return false;
					}
					sessions.set(sessionId, enqueue);
					return true;
				}).pipe(
					Effect.flatMap((claimed) =>
						claimed ? Effect.void : Effect.fail(notFound("Unknown session")),
					),
				);
			const remove = (sessionId: string, enqueue: LocalInterestSessionEnqueue) =>
				Effect.sync(() => {
					if (sessions.get(sessionId) === enqueue) {
						sessions.delete(sessionId);
					}
				});
			const enqueue = (sessionId: string, message: EntityInterestEntityUpdatedMessage) =>
				Effect.sync(() => sessions.get(sessionId)?.(message));

			return { add, remove, enqueue };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
