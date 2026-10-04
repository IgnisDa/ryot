import { Layer } from "effect";

import { EntitiesApi } from "#/api/entities";
import { PagesApi } from "#/api/pages";
import { PluginsApi } from "#/api/plugins";
import { RyotQLApi } from "#/api/ryotql";
import { PluginEntitySaves } from "#/modules/pages/bridge/entity-saves";
import { PluginOperationsService } from "#/modules/pages/bridge/operations";
import { PluginQueriesService } from "#/modules/pages/bridge/queries";
import { PluginStorage } from "#/modules/pages/bridge/storage";
import { ClientPageFreshness } from "#/modules/pages/preparation/freshness";
import { ClientStorage } from "#/persistence/storage";

export const PagesLive = Layer.mergeAll(
	ClientPageFreshness.layer.pipe(Layer.provide(PagesApi.layer)),
	PluginEntitySaves.layer.pipe(Layer.provide(EntitiesApi.layer)),
	PluginOperationsService.layer.pipe(Layer.provide(PluginsApi.layer)),
	PluginQueriesService.layer.pipe(Layer.provide(RyotQLApi.layer)),
	PluginStorage.layer.pipe(Layer.provide(ClientStorage.layer)),
);
