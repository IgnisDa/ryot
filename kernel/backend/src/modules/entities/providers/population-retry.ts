import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	EntityNotFound,
	EntityPopulationRetryRefused,
	type RetryEntityPopulationResult,
} from "@ryot-app/contract/modules/entities/schemas";
import type { EntityId, PluginId } from "@ryot-app/contract/schema/brands";
import { generateId } from "better-auth";
import { Context, Effect, Layer } from "effect";

import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { TranslationsService } from "#modules/entities/localization/service";
import {
	EntityPopulationTrigger,
	userPopulationRequest,
} from "#modules/entities/population-trigger";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";

const refused = (code: EntityPopulationRetryRefused["reason"]["code"]) =>
	new EntityPopulationRetryRefused({ reason: { code } });

export class EntityPopulationRetryService extends Context.Service<EntityPopulationRetryService>()(
	"EntityPopulationRetryService",
	{
		make: Effect.gen(function* () {
			const repository = yield* EntitiesRepository;
			const requests = yield* EnrichmentRequests;
			const translations = yield* TranslationsService;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const trigger = yield* EntityPopulationTrigger;

			const retry = Effect.fn("EntityPopulationRetryService.retry")(
				function* (input: {
					readonly entityId: EntityId;
					readonly pluginId: PluginId;
					readonly operation: "population" | "translation";
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
						(input.operation === "population" &&
							provider.rootEntitySchemaSlug !== entity.entitySchemaSlug)
					) {
						return yield* refused("provider-unavailable");
					}
					const selection = {
						entityId: entity.id,
						operation: input.operation,
						requester: user.accountGeneration,
						...(input.operation === "translation" && user.preferences.language !== null
							? { language: user.preferences.language }
							: {}),
					};
					const latestForOperation = yield* requests.latest(selection);
					const latestFull =
						input.operation === "population"
							? yield* requests.latest({ ...selection, level: "full" })
							: null;
					const latest =
						latestForOperation?.state !== "failed" &&
						latestForOperation?.state !== "cancelled" &&
						(latestFull?.state === "failed" || latestFull?.state === "cancelled")
							? latestFull
							: latestForOperation;
					if (!latest || (latest.state !== "failed" && latest.state !== "cancelled")) {
						return { retried: false } satisfies RetryEntityPopulationResult;
					}
					if (input.operation === "translation") {
						const language = user.preferences.language;
						if (language === null) {
							return { retried: false } satisfies RetryEntityPopulationResult;
						}
						const retried = yield* translations.requestFill({
							language,
							externalId,
							providerId,
							userId: user.id,
							retryOf: latest.id,
							entityId: entity.id,
							lane: "interactive",
							entitySchemaSlug: entity.entitySchemaSlug,
							accountGeneration: user.accountGeneration,
							entitySchemaPluginId: entity.entitySchemaPluginId,
						});
						return { retried } satisfies RetryEntityPopulationResult;
					}
					const retried = yield* trigger.request(
						yield* userPopulationRequest({
							providerId,
							externalId,
							initiator: user.id,
							entityId: entity.id,
							accountGeneration: user.accountGeneration,
							entitySchemaSlug: entity.entitySchemaSlug,
							entitySchemaPluginId: entity.entitySchemaPluginId,
							userId: latest.scopeUserId === null ? null : user.id,
							execution: { level: "full", retryOf: latest.id, attempt: generateId() },
						}),
					);
					return { retried } satisfies RetryEntityPopulationResult;
				},
				Effect.catchTag("SandboxRunError", Effect.die),
			);

			return { retry };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
