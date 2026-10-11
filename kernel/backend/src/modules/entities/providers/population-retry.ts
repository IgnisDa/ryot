import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	EntityNotFound,
	EntityPopulationRetryRefused,
	type RetryEntityPopulationResult,
} from "@ryot-app/contract/modules/entities/schemas";
import {
	AutomationExecutionId,
	type EntityId,
	type PluginId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, DateTime, Effect, Layer } from "effect";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import {
	entityPopulationExecutionId,
	EntityPopulationTrigger,
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
				if (cleared === null) {
					return { retried: false } satisfies RetryEntityPopulationResult;
				}
				const attempt = cleared.failedAt.getTime();
				const executionId = entityPopulationExecutionId(entity.id, user.accountGeneration, attempt);
				yield* trigger.request({
					attempt,
					providerId,
					externalId,
					entityId: entity.id,
					userId: cleared.userId,
					entitySchemaSlug: entity.entitySchemaSlug,
					entitySchemaPluginId: entity.entitySchemaPluginId,
					command: {
						...rootLifecycleCommand({
							source: "api",
							lane: "interactive",
							itemIdentity: executionId,
							initiator: { id: user.id, kind: "user" },
							accountGeneration: user.accountGeneration,
							executionId: AutomationExecutionId.make(executionId),
							occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
						}),
						writeContext: null,
					},
				});
				return { retried: true } satisfies RetryEntityPopulationResult;
			});

			return { retry };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
