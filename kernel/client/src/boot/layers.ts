import { Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import { PublicApi } from "#/api/public";
import { AuthClient } from "#/modules/auth/client";
import { AuthService } from "#/modules/auth/service";
import { ArtifactSessions } from "#/modules/plugins/artifact-sessions";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { PluginCatalogEventsService } from "#/modules/plugins/events";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ServerService } from "#/modules/server/service";
import { ClientStorage } from "#/persistence/storage";

const InfrastructureLive = Layer.mergeAll(
	ClientStorage.layer,
	PublicApi.layer,
	AuthenticatedApi.layer,
);

const AuthClientLive = AuthClient.layer.pipe(Layer.provideMerge(InfrastructureLive));

export const ClientLive = Layer.mergeAll(
	AuthService.layer,
	ServerService.layer,
	ArtifactSessions.layer,
	PluginCatalogService.layer,
	PluginCatalogEventsService.layer,
	PluginOperationsService.layer,
	PluginQueriesService.layer,
).pipe(Layer.provideMerge(AuthClientLive));
