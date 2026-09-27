import { Effect, Layer } from "effect";
import { MessageStorage, Snowflake, SqlMessageStorage } from "effect/cluster";

import { DatabaseSession } from "#platform/db/session";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";

import { workflowEntityPrefix } from "./workflow-models";
import { WorkflowGarbageCollectionRepository } from "./workflow-repository";

export const WorkflowGarbageCollectionStorageLive = Layer.effect(
	MessageStorage.MessageStorage,
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const repository = yield* WorkflowGarbageCollectionRepository;
		const notifications = yield* WorkflowExecutionNotifications;
		const storage = yield* SqlMessageStorage.makeEncoded();
		return yield* MessageStorage.makeEncoded({
			...storage,
			saveReply: (reply) =>
				session
					.transaction(
						Effect.gen(function* () {
							const request = yield* repository.prepareReply(reply);
							if (!request) {
								return undefined;
							}
							yield* storage.saveReply(reply);
							return yield* repository.complete(reply, request);
						}),
					)
					.pipe(
						Effect.orDie,
						Effect.flatMap((identity) =>
							identity ? notifications.publish(identity) : Effect.void,
						),
					),
			saveEnvelope: (options) =>
				session
					.transaction(
						Effect.gen(function* () {
							const { envelope } = options;
							if (
								!envelope.address.entityType.startsWith(workflowEntityPrefix) ||
								(envelope._tag === "Request" && envelope.tag === "run")
							) {
								yield* repository.admit(envelope);
								return yield* storage.saveEnvelope(options);
							}
							// A re-sent envelope inserts no row, so only a new row needs the expiry fence.
							// Taking the root lock after the insert in the same transaction fences it equally.
							const result = yield* storage.saveEnvelope(options);
							if (result._tag === "Success") {
								yield* repository.admit(envelope);
							}
							return result;
						}),
					)
					.pipe(Effect.orDie),
		});
	}),
).pipe(
	Layer.provide(WorkflowGarbageCollectionRepository.layer),
	Layer.provide(Snowflake.layerGenerator),
);
