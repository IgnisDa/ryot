import type { EntityId } from "@ryot-app/contract/schema/brands";
import { Context, Duration, Effect, Layer } from "effect";

import { TranslationsService } from "#modules/entities/localization/service";
import { EntitiesService } from "#modules/entities/service";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { ENTITY_WATCH_PROGRESSION_LEASE_SECONDS, redisKeys, RedisService } from "#platform/redis";

import { EntityWatchStore } from "./store";

export class EntityWatchProgression extends Context.Service<EntityWatchProgression>()(
	"EntityWatchProgression",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const store = yield* EntityWatchStore;
			const entities = yield* EntitiesService;
			const translations = yield* TranslationsService;
			const providerResolver = yield* PluginRuntimeResolver;

			const requestTranslations = Effect.fn("EntityWatchProgression.requestTranslations")(
				function* (entityId: EntityId) {
					const sessionIds = yield* store.listInterestedSessions(entityId);
					const metadata = yield* store.getSessionMetadata(sessionIds);
					const interests = new Map(
						metadata.flatMap(({ userId, preferredLanguage, accountGeneration }) =>
							preferredLanguage === null
								? []
								: [
										[
											`${userId}\0${preferredLanguage}`,
											{ userId, preferredLanguage, accountGeneration },
										] as const,
									],
						),
					).values();
					if (metadata.length === 0) {
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
					const requestedLanguages = new Set<string>();
					for (const { userId, preferredLanguage, accountGeneration } of interests) {
						if (requestedLanguages.has(preferredLanguage)) {
							continue;
						}
						const provider = yield* providerResolver.findProviderAvailableToUser(
							userId,
							entity.providerId,
						);
						const canonicalLanguage = provider?.information.canonicalLanguage;
						if (
							provider?.pluginId !== entity.entitySchemaPluginId ||
							provider.rootEntitySchemaSlug !== entity.entitySchemaSlug
						) {
							continue;
						}
						if (canonicalLanguage && preferredLanguage !== canonicalLanguage) {
							yield* translations
								.requestFill({
									userId,
									entityId,
									accountGeneration,
									lane: "interactive",
									language: preferredLanguage,
									externalId: entity.externalId,
									properties: entity.properties,
									providerId: entity.providerId,
									entitySchemaSlug: entity.entitySchemaSlug,
									entitySchemaPluginId: entity.entitySchemaPluginId,
								})
								.pipe(
									Effect.catchTag("SandboxRunError", (error) =>
										error.kind === "missing-artifact" || error.kind === "invalid-input"
											? Effect.void
											: Effect.fail(error),
									),
								);
							requestedLanguages.add(preferredLanguage);
						}
					}
				},
			);

			const populated = Effect.fn("EntityWatchProgression.populated")(function* (
				entityId: EntityId,
			) {
				const leaseKey = redisKeys.entityWatchProgressionLease(entityId);
				let owner = yield* redis.acquireLease(leaseKey, ENTITY_WATCH_PROGRESSION_LEASE_SECONDS);
				if (owner === null) {
					yield* Effect.sleep(Duration.seconds(ENTITY_WATCH_PROGRESSION_LEASE_SECONDS - 1));
					owner = yield* redis.acquireLease(leaseKey, ENTITY_WATCH_PROGRESSION_LEASE_SECONDS);
				}
				if (owner !== null) {
					yield* requestTranslations(entityId).pipe(
						Effect.catchTag("EntityNotFound", () => Effect.void),
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
