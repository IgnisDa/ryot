import { notFound } from "@ryot/contract/errors";
import type { EntityUpdatedFrame } from "@ryot/contract/modules/entity-interest/messages";
import { Context, Effect, Layer } from "effect";

export type LocalStreamEnqueue = (frame: EntityUpdatedFrame) => void;

export class LocalStreamConnections extends Context.Service<LocalStreamConnections>()(
	"LocalStreamConnections",
	{
		make: Effect.sync(() => {
			const connections = new Map<string, LocalStreamEnqueue>();
			const add = (streamId: string, enqueue: LocalStreamEnqueue) =>
				Effect.sync(() => {
					if (connections.has(streamId)) {
						return false;
					}
					connections.set(streamId, enqueue);
					return true;
				}).pipe(
					Effect.flatMap((claimed) =>
						claimed ? Effect.void : Effect.fail(notFound("Unknown stream")),
					),
				);
			const remove = (streamId: string, enqueue: LocalStreamEnqueue) =>
				Effect.sync(() => {
					if (connections.get(streamId) === enqueue) {
						connections.delete(streamId);
					}
				});
			const enqueue = (streamId: string, frame: EntityUpdatedFrame) =>
				Effect.sync(() => connections.get(streamId)?.(frame));

			return { add, remove, enqueue };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
