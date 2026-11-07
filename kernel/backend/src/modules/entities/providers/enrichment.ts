import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	EntityEnrichmentRefused,
	EntityNotFound,
	type RequestEntityEnrichmentBody,
	type RequestEntityEnrichmentResult,
} from "@ryot-app/contract/modules/entities/schemas";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { generateId } from "better-auth";
import { Context, Effect, Layer } from "effect";

import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { TranslationsService } from "#modules/entities/localization/service";
import { explicitTranslationExecutionId } from "#modules/entities/localization/translation-request";
import {
	entityPopulationExecutionId,
	EntityPopulationTrigger,
	userPopulationRequest,
} from "#modules/entities/population-trigger";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";

const refused = (code: EntityEnrichmentRefused["reason"]["code"]) =>
	new EntityEnrichmentRefused({ reason: { code } });

export class EntityEnrichmentService extends Context.Service<EntityEnrichmentService>()(
	"@ryot-app/kernel-backend/modules/entities/providers/enrichment/EntityEnrichmentService",
	{
		make: Effect.gen(function* () {
			const repository = yield* EntitiesRepository;
			const requests = yield* EnrichmentRequests;
			const translations = yield* TranslationsService;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const trigger = yield* EntityPopulationTrigger;

			const request = Effect.fn("EntityEnrichmentService.request")(
				function* (
					input: typeof RequestEntityEnrichmentBody.Type & {
						readonly entityId: EntityId;
						readonly user: CurrentUserValue;
					},
				) {
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
						requester: user.id,
						entityId: entity.id,
						operation: input.operation,
						...(input.operation === "translation" && user.preferences.language !== null
							? { language: user.preferences.language }
							: {}),
					};
					const inputHash = sha256Hex(stableStringify({ ...input, user: user.id }));
					const attempt = generateId();
					const execution = {
						attempt,
						level: "full" as const,
						mode: "refresh" as const,
						manualRefresh: input.action === "refresh",
						...(user.preferences.language
							? { translationLanguage: user.preferences.language }
							: {}),
					};
					const executionId =
						input.operation === "population"
							? entityPopulationExecutionId(entity.id, user.id, execution)
							: explicitTranslationExecutionId(entity.id, user.preferences.language ?? "", attempt);
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
					if (
						input.action === "retry" &&
						(!latest || (latest.state !== "failed" && latest.state !== "cancelled"))
					) {
						return { enrichmentRequestId: null } satisfies RequestEntityEnrichmentResult;
					}
					if (input.operation === "translation") {
						const language = user.preferences.language;
						if (language === null) {
							return { enrichmentRequestId: null } satisfies RequestEntityEnrichmentResult;
						}
						yield* translations.requestFill({
							language,
							inputHash,
							externalId,
							providerId,
							userId: user.id,
							refreshKey: attempt,
							...(input.action === "retry" && latest ? { retryOf: latest.id } : {}),
							entityId: entity.id,
							lane: "interactive",
							entitySchemaSlug: entity.entitySchemaSlug,
							entitySchemaPluginId: entity.entitySchemaPluginId,
						});
						const admitted = yield* requests.get(executionId);
						return {
							enrichmentRequestId: admitted?.id ?? null,
						} satisfies RequestEntityEnrichmentResult;
					}
					yield* trigger.request(
						yield* userPopulationRequest({
							providerId,
							externalId,
							initiator: user.id,
							entityId: entity.id,
							accountUserId: user.id,
							entitySchemaSlug: entity.entitySchemaSlug,
							entitySchemaPluginId: entity.entitySchemaPluginId,
							userId: provider.pluginScope === "system" ? null : user.id,
							execution: {
								...execution,
								inputHash,
								...(input.action === "retry" && latest ? { retryOf: latest.id } : {}),
							},
						}),
					);
					const admitted = yield* requests.get(executionId);
					return {
						enrichmentRequestId: admitted?.id ?? null,
					} satisfies RequestEntityEnrichmentResult;
				},
				Effect.catchTag("SandboxRunError", (error) =>
					error.kind === "resource-unavailable" && error.data?.code === "execution-limit"
						? Effect.fail(refused("backlog-full"))
						: Effect.die(error),
				),
			);

			return { request };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
