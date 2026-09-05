import { Layer } from "effect";

import { PluginsApi } from "#/api/plugins";
import { RyotQLApi } from "#/api/ryotql";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { PluginCatalogEventsService } from "#/modules/plugins/events";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { PluginStorage } from "#/modules/plugins/storage";

export const PluginsLive = Layer.mergeAll(
	PluginCatalogService.layer,
	PluginCatalogEventsService.layer.pipe(Layer.provide(OAuthTokenService.layer)),
	PluginOperationsService.layer.pipe(Layer.provide(PluginsApi.layer)),
	PluginQueriesService.layer.pipe(Layer.provide(RyotQLApi.layer)),
	PluginStorage.layer,
);
