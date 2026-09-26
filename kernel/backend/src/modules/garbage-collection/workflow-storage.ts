import { Effect, Layer } from "effect";
import { MessageStorage, Snowflake, SqlMessageStorage } from "effect/cluster";

import { DatabaseSession } from "#platform/db/session";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";

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
			saveEnvelope: (options) =>
				session
					.transaction(
						Effect.gen(function* () {
							yield* repository.admit(options.envelope);
							return yield* storage.saveEnvelope(options);
						}),
					)
					.pipe(Effect.orDie),
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
		});
	}),
).pipe(
	Layer.provide(WorkflowGarbageCollectionRepository.layer),
	Layer.provide(Snowflake.layerGenerator),
);
