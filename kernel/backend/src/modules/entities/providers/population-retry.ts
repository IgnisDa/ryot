import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	EntityNotFound,
	EntityPopulationRetryRefused,
	type RetryEntityPopulationResult,
} from "@ryot-app/contract/modules/entities/schemas";
import type { EntityId, PluginId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import {
	EntityPopulationTrigger,
	userPopulationRequest,
} from "#modules/entities/population-trigger";
import { EntitiesRepository } from "#modules/entities/repository";
import { MutationReceipts } from "#modules/mutations/receipts";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { DatabaseSession } from "#platform/db/session";

const refused = (code: EntityPopulationRetryRefused["reason"]["code"]) =>
	new EntityPopulationRetryRefused({ reason: { code } });

export class EntityPopulationRetryService extends Context.Service<EntityPopulationRetryService>()(
	"EntityPopulationRetryService",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EntitiesRepository;
			const receipts = yield* MutationReceipts.make;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const trigger = yield* EntityPopulationTrigger;

			const retry = Effect.fn("EntityPopulationRetryService.retry")(function* (input: {
				readonly entityId: EntityId;
				readonly pluginId: PluginId;
				readonly user: CurrentUserValue;
			}) {
				const { user } = input;
				const entity = yield* repository.getByIdForUser({
					userId: user.id,
					entityId: input.entityId,
				});
				if (entity === null) {
					return yield* new EntityNotFound({
						reason: { entityId: input.entityId, code: "entity-not-found" },
					});
				}
				const { providerId, externalId } = entity;
				if (providerId === null || externalId === null) {
					return yield* refused("not-provider-backed");
				}
				if (entity.entitySchemaPluginId !== input.pluginId) {
					return yield* refused("plugin-mismatch");
				}
				const provider = yield* pluginRuntime.findProviderAvailableToUser(user.id, providerId);
				if (
					provider?.pluginId !== entity.entitySchemaPluginId ||
					provider.rootEntitySchemaSlug !== entity.entitySchemaSlug
				) {
					return yield* refused("provider-unavailable");
				}
				const cleared = yield* session
					.transaction(
						Effect.gen(function* () {
							yield* session.acquireUserWriteLock(user.id);
							yield* receipts.admitAccount(user.accountGeneration);
							yield* repository.lockMutationKeys([entity.id]);
							return yield* repository.clearPopulationFailure(entity.id);
						}),
					)
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
				const failedAt = cleared?.failedAt ?? cleared?.relatedFailedAt ?? null;
				if (cleared === null || failedAt === null) {
					return { retried: false } satisfies RetryEntityPopulationResult;
				}
				yield* trigger.request(
					yield* userPopulationRequest({
						providerId,
						externalId,
						initiator: user.id,
						entityId: entity.id,
						userId: cleared.userId,
						accountGeneration: user.accountGeneration,
						entitySchemaSlug: entity.entitySchemaSlug,
						entitySchemaPluginId: entity.entitySchemaPluginId,
						execution: { level: "full", attempt: failedAt.getTime() },
					}),
				);
				return { retried: true } satisfies RetryEntityPopulationResult;
			});

			return { retry };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
