import type { EntityId } from "@ryot/contract/schema/brands";
import { Context, Duration, Effect, Layer } from "effect";

import {
	ENTITY_INTEREST_PROGRESSION_LEASE_SECONDS,
	redisKeys,
	RedisService,
} from "#lib/infrastructure/redis";
import { EntitiesService } from "#modules/entities/service";
import { TranslationsService } from "#modules/entity-translation/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { EntityInterestStore } from "./store";

export class EntityInterestProgression extends Context.Service<EntityInterestProgression>()(
	"EntityInterestProgression",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const store = yield* EntityInterestStore;
			const entities = yield* EntitiesService;
			const translations = yield* TranslationsService;
			const providerResolver = yield* PluginRuntimeResolver;

			const requestTranslations = Effect.fn("EntityInterestProgression.requestTranslations")(
				function* (entityId: EntityId) {
					const sessionIds = yield* store.listInterestedSessions(entityId);
					const metadata = yield* store.getSessionMetadata(sessionIds);
					const languages = Array.from(
						new Set(
							metadata.flatMap(({ preferredLanguage }) =>
								preferredLanguage === null ? [] : [preferredLanguage],
							),
						),
					);
					if (languages.length === 0) {
						return;
					}

					const entity = yield* entities.getByIdAnyScope(entityId);
					if (
						entity.populatedAt === null ||
						entity.externalId === null ||
						entity.providerId === null
					) {
						return;
					}
					const provider = yield* providerResolver.findActiveProviderById(entity.providerId);
					const canonicalLanguage = provider?.information.canonicalLanguage;
					if (!canonicalLanguage) {
						return;
					}

					for (const language of languages) {
						if (language !== canonicalLanguage) {
							yield* translations.requestFill({
								language,
								entityId,
								externalId: entity.externalId,
								properties: entity.properties,
								providerId: entity.providerId,
								entitySchemaSlug: entity.entitySchemaSlug,
							});
						}
					}
				},
			);

			const populated = Effect.fn("EntityInterestProgression.populated")(function* (
				entityId: EntityId,
			) {
				const leaseKey = redisKeys.entityInterestProgressionLease(entityId);
				let owner = yield* redis.acquireLease(leaseKey, ENTITY_INTEREST_PROGRESSION_LEASE_SECONDS);
				if (owner === null) {
					yield* Effect.sleep(Duration.seconds(ENTITY_INTEREST_PROGRESSION_LEASE_SECONDS - 1));
					owner = yield* redis.acquireLease(leaseKey, ENTITY_INTEREST_PROGRESSION_LEASE_SECONDS);
				}
				if (owner !== null) {
					yield* requestTranslations(entityId).pipe(
						Effect.ensuring(redis.releaseLease(leaseKey, owner)),
					);
				}
			});

			return { populated };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
