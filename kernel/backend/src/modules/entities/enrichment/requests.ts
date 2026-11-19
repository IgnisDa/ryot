import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, Effect, Layer } from "effect";

import { publishEntityUpdated } from "#modules/live-updates/publish";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { DatabaseSession } from "#platform/db/session";

import {
	type EnrichmentRequestInput,
	type EnrichmentRequestPatch,
	EnrichmentRequestsRepository,
} from "./repository";

export class EnrichmentRequests extends Context.Service<EnrichmentRequests>()(
	"@ryot-app/kernel-backend/modules/entities/enrichment/requests/EnrichmentRequests",
	{
		make: Effect.gen(function* () {
			const repository = yield* EnrichmentRequestsRepository;
			const session = yield* DatabaseSession;
			const admission = yield* AccountAdmission.make;
			const publish = Effect.fnUntraced(function* (
				row: Effect.Success<ReturnType<typeof repository.get>>,
			) {
				if (row?.entityId && row.requesterUserId) {
					yield* publishEntityUpdated(EntityId.make(row.entityId), "enrichment-updated", [
						UserId.make(row.requesterUserId),
					]).pipe(
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
							yield* session.acquireUserWriteLock(input.requester);
							yield* admission.admitAccount(input.requester);
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
						row.requesterUserId !== input.requester ||
						row.operation !== input.operation ||
						row.language !== input.language ||
						row.scopeUserId !== input.scopeUserId ||
						(row.id === input.id &&
							input.inputHash !== undefined &&
							row.inputHash !== input.inputHash)
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
					yield* publish(yield* repository.update(id, patch));
					for (const follower of yield* repository.followers(id)) {
						yield* publish(yield* repository.update(follower.id, patch));
					}
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
				account: repository.account,
				lockTarget: repository.lockTarget,
				requesterIds: repository.requesterIds,
				recordBaseCheck: repository.recordBaseCheck,
				latestTranslation: repository.latestTranslation,
				failOrphaned: (limit: number) =>
					Effect.gen(function* () {
						for (const row of yield* repository.failOrphaned(limit)) {
							if (row.entity_id !== null && row.requester_user_id !== null) {
								yield* publishEntityUpdated(EntityId.make(row.entity_id), "enrichment-updated", [
									UserId.make(row.requester_user_id),
								]);
							}
						}
					}),
				guardPopulation: Effect.fnUntraced(
					function* (id: string, attempt?: number) {
						if (!(yield* repository.guardPopulation(id, attempt))) {
							return yield* new SandboxRunError({
								kind: "invalid-input",
								message: "Provider population no longer owns its writes",
							});
						}
						return yield* Effect.void;
					},
					Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
				),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(EnrichmentRequestsRepository.layer),
	);
}
