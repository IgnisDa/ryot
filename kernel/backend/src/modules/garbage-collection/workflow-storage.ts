import { Effect, Layer } from "effect";
import { MessageStorage, Snowflake, SqlMessageStorage } from "effect/cluster";

import { DatabaseSession } from "#lib/infrastructure/db/session";

import { WorkflowGarbageCollectionRepository } from "./workflow-repository";

export const WorkflowGarbageCollectionStorageLive = Layer.effect(
	MessageStorage.MessageStorage,
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const repository = yield* WorkflowGarbageCollectionRepository;
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
								return;
							}
							yield* storage.saveReply(reply);
							yield* repository.complete(reply, request);
						}),
					)
					.pipe(Effect.orDie),
		});
	}),
).pipe(
	Layer.provide(WorkflowGarbageCollectionRepository.layer),
	Layer.provide(Snowflake.layerGenerator),
);
