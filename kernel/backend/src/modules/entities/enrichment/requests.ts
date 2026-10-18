import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import { encodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-watches/messages";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, Effect, Layer } from "effect";

import { MutationReceipts } from "#modules/mutations/receipts";
import { DatabaseSession } from "#platform/db/session";
import { redisKeys, RedisService } from "#platform/redis";

import {
	type EnrichmentRequestInput,
	type EnrichmentRequestPatch,
	EnrichmentRequestsRepository,
} from "./repository";

export class EnrichmentRequests extends Context.Service<EnrichmentRequests>()(
	"EnrichmentRequests",
	{
		make: Effect.gen(function* () {
			const repository = yield* EnrichmentRequestsRepository;
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts.make;
			const redis = yield* RedisService;
			const publish = Effect.fnUntraced(function* (
				row: Effect.Success<ReturnType<typeof repository.get>>,
			) {
				if (row?.entityId) {
					yield* redis
						.publish(
							redisKeys.entityUpdatedChannel,
							encodeEntityUpdatedMessage(
								EntityId.make(row.entityId),
								"enrichment-updated",
								row.requesterUserId ? UserId.make(row.requesterUserId) : undefined,
							),
						)
						.pipe(
							Effect.catchCauseIf(
								(cause) => !Cause.hasInterruptsOnly(cause),
								(cause) => Effect.logWarning("enrichment update publication failed", cause),
							),
						);
				}
			});
			const ensure = Effect.fn("EnrichmentRequests.ensure")(
				function* (input: EnrichmentRequestInput) {
					const admit = Effect.gen(function* () {
						if (input.requester) {
							yield* session.acquireUserWriteLock(input.requester.userId);
							yield* receipts.admitAccount(input.requester);
						}
						return yield* repository.ensure(input);
					});
					const row = yield* (yield* session.isTransactionActive)
						? admit
						: session.transaction(admit);
					if (!row) {
						return yield* new SandboxRunError({
							kind: "infrastructure",
							message: "Enrichment request admission returned no row",
						});
					}
					if (
						row.providerId !== input.providerId ||
						row.externalId !== input.externalId ||
						row.pluginId !== input.pluginId ||
						row.entitySchemaSlug !== input.entitySchemaSlug ||
						row.requesterUserId !== (input.requester?.userId ?? null) ||
						row.requesterGeneration !== (input.requester?.token ?? null) ||
						row.operation !== input.operation ||
						row.language !== input.language ||
						row.scopeUserId !== input.scopeUserId
					) {
						return yield* new SandboxRunError({
							kind: "invalid-input",
							message: "Enrichment request identity was reused for another target",
						});
					}
					return row;
				},
				Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
			);
			const update = Effect.fn("EnrichmentRequests.update")(
				function* (id: string, patch: EnrichmentRequestPatch) {
					const row = yield* repository.update(id, patch);
					yield* publish(row);
				},
				Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
			);
			const attachEntity = Effect.fn("EnrichmentRequests.attachEntity")(
				(id: string, entityId: EntityId) =>
					repository
						.attachEntity(id, entityId)
						.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure"))),
			);
			return {
				ensure,
				update,
				attachEntity,
				get: repository.get,
				prune: repository.prune,
				latest: repository.latest,
				pending: repository.pending,
				account: repository.account,
				observed: repository.observed,
				released: repository.released,
				lockTarget: repository.lockTarget,
				expiredExecutionStatus: repository.expiredExecutionStatus,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(EnrichmentRequestsRepository.layer),
	);
}
