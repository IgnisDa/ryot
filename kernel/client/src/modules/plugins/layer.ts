import { Layer } from "effect";

import { OAuthTokenService } from "#/modules/auth/token-service";
import { PluginCatalogEventsService } from "#/modules/plugins/catalog/events";
import { PluginCatalogService } from "#/modules/plugins/catalog/service";
import { PluginManagementLive } from "#/modules/plugins/management/service";

export const PluginsLive = Layer.mergeAll(
	PluginManagementLive,
	PluginCatalogService.layer,
	PluginCatalogEventsService.layer.pipe(Layer.provide(OAuthTokenService.layer)),
);
