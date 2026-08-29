import { encodePluginCatalogInvalidatedMessage } from "@ryot-app/contract/modules/plugins/contract";
import { UserId } from "@ryot-app/contract/schema/brands";
import { isNotNull } from "drizzle-orm";
import { Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { PackageCacheManager } from "#lib/infrastructure/sandbox-runtime/runtime";
import { ClientSurfaceMaterializerLive, ClientPagesServiceLive } from "#modules/client-pages/layer";
import { ClientPagesService } from "#modules/client-pages/service";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import {
	IntegrationPluginRevisionActivationLive,
	IntegrationsRepository,
} from "#modules/integrations/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";
import { SavedViewPluginReferencesProvidedLive } from "#modules/saved-views/layer";
import { ObjectStorageServiceLive, UploadServicesLive } from "#modules/uploads/layer";

import { PluginBackupRestore } from "./backup-restore";
import { SystemPluginBootstrap } from "./boot";
import {
	PluginCatalogInvalidator,
	PluginCatalogHub,
	PluginInvalidationSubscriber,
} from "./catalog-events";
import { publishAfterCatalogMaterialization } from "./catalog-materialization";
import { PluginIngestionLock } from "./ingestion-lock";
import { PluginInstallationRepository } from "./installation-repository";
import { PluginInstallationService } from "./installation-service";
import {
	PluginInstallationLifecycleDispatcher,
	PluginInstallationLifecycleDispatcherLive,
} from "./installation-workflow";
import { PluginRepository } from "./repository";
import { ScriptGarbageCollector } from "./script-garbage-collector";
import { PluginIngestionService } from "./service";
import { SystemPlugins } from "./system";

export const PluginRevisionActivationLive = IntegrationPluginRevisionActivationLive.pipe(
	Layer.provide(IntegrationsRepository.layer),
);

export const PluginIngestionLockLive = PluginIngestionLock.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			PluginRepository.layer,
			PluginInstallationRepository.layer,
			PluginRevisionActivationLive,
		),
	),
);

export const ScriptGarbageCollectorLive = ScriptGarbageCollector.layer.pipe(
	Layer.provide(Layer.merge(PluginRepository.layer, PackageCacheManager.layer)),
);

export const PluginInvalidationSubscriberLive = PluginInvalidationSubscriber.layer.pipe(
	Layer.provide(PluginCatalogHub.layer),
);

export const MaterializingPluginCatalogInvalidatorLive = Layer.effect(
	PluginCatalogInvalidator,
	Effect.gen(function* () {
		const redis = yield* RedisService;
		const session = yield* DatabaseSession;
		const pages = yield* ClientPagesService;
		const materialize = (userId: UserId) => pages.materializeUserCompositions(userId);
		return {
			user: (userId: UserId) =>
				publishAfterCatalogMaterialization(
					Effect.succeed([userId]),
					materialize,
					redis.publish(
						redisKeys.pluginCatalogUserChannel,
						encodePluginCatalogInvalidatedMessage({ userId }),
					),
				).pipe(Effect.asVoid, Effect.orDie),
			all: publishAfterCatalogMaterialization(
				session
					.run((db) =>
						db
							.select({ id: schema.user.id })
							.from(schema.user)
							.where(isNotNull(schema.user.bootstrapCompletedAt)),
					)
					.pipe(Effect.map((users) => users.map((user) => UserId.make(user.id)))),
				materialize,
				redis
					.publish(redisKeys.pluginCatalogChannel, "plugin-catalog-invalidated")
					.pipe(Effect.asVoid),
			).pipe(Effect.orDie),
		};
	}),
).pipe(Layer.provide(ClientPagesServiceLive), Layer.provide(RedisService.layer));

export const PluginIngestionServiceLive = PluginIngestionService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			PluginRevisionActivationLive,
			PluginRepository.layer,
			DefinitionRepository.layer,
			SystemPlugins.layer,
			MaterializingPluginCatalogInvalidatorLive,
		),
	),
);

const installationRepositories = Layer.mergeAll(
	DefinitionRepository.layer,
	PluginRepository.layer,
	PluginInstallationRepository.layer,
	SandboxWorkflowReferenceRepository.layer,
);

export const PluginInstallationMigrationLive = PluginInstallationService.layerMigration.pipe(
	Layer.provide(
		Layer.mergeAll(
			installationRepositories,
			PluginCatalogInvalidator.layer,
			PluginInstallationLifecycleDispatcher.layer,
			UploadServicesLive,
			ObjectStorageServiceLive,
			PluginIngestionLockLive,
			SavedViewPluginReferencesProvidedLive,
		),
	),
);

export const PluginInstallationRuntimeLive = PluginInstallationService.layerRuntime.pipe(
	Layer.provide(
		Layer.mergeAll(
			installationRepositories,
			PluginInstallationLifecycleDispatcherLive,
			UploadServicesLive,
			ObjectStorageServiceLive,
			PluginIngestionLockLive,
			SavedViewPluginReferencesProvidedLive,
			MaterializingPluginCatalogInvalidatorLive,
		),
	),
);

export const PluginBackupRestoreLive = PluginBackupRestore.layer.pipe(
	Layer.provide(
		Layer.mergeAll(PluginRepository.layer, DefinitionRepository.layer, PluginIngestionLockLive),
	),
);

export const SystemPluginIngestionLive = SystemPluginBootstrap.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ClientSurfaceMaterializerLive,
			PluginIngestionServiceLive,
			PluginRepository.layer,
			DefinitionRepository.layer,
			ScriptGarbageCollectorLive,
			PluginInstallationMigrationLive,
			SystemPlugins.layer,
		),
	),
);
