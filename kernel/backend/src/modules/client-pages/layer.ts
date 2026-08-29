import { Effect, Layer } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { ReusableCapabilityGrantStoreLive } from "#lib/infrastructure/reusable-capability-grants";
import { ImageClientArtifacts } from "#modules/client-artifacts/image-artifacts";
import { ClientArtifactStoreLive } from "#modules/client-artifacts/layer";
import { ClientArtifactsRepository } from "#modules/client-artifacts/repository";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginCatalogInvalidatorLive } from "#modules/plugins/catalog-events";
import { ClientSurfaceMaterializer } from "#modules/plugins/client-surface-materializer";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";

import { ClientPageCompositionService } from "./composition-service";
import { ClientDocumentGrantService } from "./grant-service";
import { ClientPagesRepository } from "./repository";
import { ClientPagesService } from "./service";

export const ClientDocumentGrantServiceLive = ClientDocumentGrantService.layer.pipe(
	Layer.provide(ReusableCapabilityGrantStoreLive),
);

const composition = ClientPageCompositionService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ClientPagesRepository.layer,
			ClientArtifactStoreLive,
			ImageClientArtifacts.layer,
		),
	),
);

export const ClientPagesServiceLive = ClientPagesService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ClientPagesRepository.layer,
			EntitiesRepository.layer.pipe(Layer.provide(PluginRuntimeResolverLive)),
			composition,
			ClientDocumentGrantServiceLive,
			ImageClientArtifacts.layer,
			PluginCatalogInvalidatorLive,
			PluginRepository.layer.pipe(Layer.provide(ClientArtifactsRepository.layer)),
			PluginRuntimeResolverLive,
		),
	),
	Layer.provide(DefinitionRepository.layer),
);

export const ClientSurfaceMaterializerLive = Layer.effect(
	ClientSurfaceMaterializer,
	Effect.gen(function* () {
		const pages = yield* ClientPagesService;
		const session = yield* DatabaseSession;
		return {
			materializeSystemCompositions: pages
				.materializeSystemCompositions()
				.pipe(Effect.provideService(DatabaseSession, session), Effect.orDie),
			assertUserCompositions: (userId) =>
				pages
					.assertUserCompositions(userId)
					.pipe(Effect.provideService(DatabaseSession, session), Effect.orDie),
			materializeUserCompositions: (userId) =>
				pages
					.materializeUserCompositions(userId)
					.pipe(Effect.provideService(DatabaseSession, session), Effect.orDie),
			materializeRenderer: (userId, renderer) =>
				pages
					.materializeRenderer(userId, renderer)
					.pipe(Effect.provideService(DatabaseSession, session), Effect.orDie),
			materializePendingInstallation: (userId, installationId) =>
				pages
					.materializePendingInstallation(userId, installationId)
					.pipe(Effect.provideService(DatabaseSession, session), Effect.orDie),
		};
	}),
).pipe(Layer.provide(ClientPagesServiceLive));
