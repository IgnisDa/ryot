import { DbError } from "@ryot-app/contract/errors";
import { Effect, Layer } from "effect";
import { MessageStorage, Snowflake, SqlMessageStorage } from "effect/cluster";

import { databaseError } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";
import {
	workflowMessageExpiredCode,
	workflowMessageUnadmittedCode,
} from "#platform/db/workflow-message-fence";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";

import { WorkflowExecutionExpired, workflowEntityPrefix } from "./workflow-models";
import { WorkflowGarbageCollectionRepository } from "./workflow-repository";

export const WorkflowGarbageCollectionStorageLive = Layer.effect(
	MessageStorage.MessageStorage,
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const repository = yield* WorkflowGarbageCollectionRepository;
		const notifications = yield* WorkflowExecutionNotifications;
		// TODO: https://github.com/Effect-TS/effect/issues/9321
		// makeEncoded always runs Effect's migrator; migrate.ts already ran it, so this run is a no-op.
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
			saveEnvelope: (options) => {
				const { address } = options.envelope;
				if (!address.entityType.startsWith(workflowEntityPrefix)) {
					return storage.saveEnvelope(options).pipe(Effect.orDie);
				}
				if (options.envelope._tag === "Request" && options.envelope.tag === "run") {
					return session
						.transaction(
							Effect.andThen(repository.admit(options.envelope), storage.saveEnvelope(options)),
						)
						.pipe(Effect.orDie);
				}
				// The ryot_cluster_message_fence trigger fences these envelopes inside their insert.
				return storage.saveEnvelope(options).pipe(
					Effect.catchTag("PersistenceError", (error) => {
						const { code } = databaseError(error.cause);
						if (code === workflowMessageExpiredCode) {
							return Effect.die(
								new WorkflowExecutionExpired({
									executionId: address.entityId,
									workflowName: address.entityType.slice(workflowEntityPrefix.length),
								}),
							);
						}
						return Effect.die(
							code === workflowMessageUnadmittedCode
								? new DbError({ message: "Workflow message has no admitted execution" })
								: error,
						);
					}),
				);
			},
		});
	}),
).pipe(
	Layer.provide(WorkflowGarbageCollectionRepository.layer),
	Layer.provide(Snowflake.layerGenerator),
);
