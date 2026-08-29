import { Layer } from "effect";

import { LifecycleServicesLive, MigrationLifecycleServicesLive } from "#modules/automations/layer";

import { EntitiesRepositoryLive } from "./repository";
import { EntitiesService } from "./service";

export const EntitiesServiceRuntimeLive = EntitiesService.layerRuntime.pipe(
	Layer.provide(Layer.merge(EntitiesRepositoryLive, LifecycleServicesLive)),
);

export const EntitiesServiceMigrationLive = EntitiesService.layerMigration.pipe(
	Layer.provide(Layer.merge(EntitiesRepositoryLive, MigrationLifecycleServicesLive)),
);
