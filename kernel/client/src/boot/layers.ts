import { Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import { PublicApi } from "#/api/public";
import { AuthClient } from "#/modules/auth/client";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { OAuthLauncher } from "#/modules/auth/oauth-launcher";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { AuthService } from "#/modules/auth/service";
import { ArtifactSessions } from "#/modules/plugins/artifact-sessions";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { PluginCatalogEventsService } from "#/modules/plugins/events";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ServerService } from "#/modules/server/service";
import { ClientStorage } from "#/persistence/storage";

const InfrastructureLive = Layer.mergeAll(PublicApi.layer, AuthenticatedApi.layer).pipe(
	Layer.provideMerge(ClientStorage.layer),
);

const AuthClientLive = AuthClient.layer.pipe(Layer.provideMerge(InfrastructureLive));
const ServerLive = ServerService.layer.pipe(Layer.provideMerge(InfrastructureLive));
const OAuthLauncherLive = OAuthLauncher.layer.pipe(
	Layer.provideMerge(OAuthStorage.layer),
	Layer.provideMerge(ServerLive),
	Layer.provideMerge(InfrastructureLive),
);

export const ClientLive = Layer.mergeAll(
	AuthService.layer,
	OAuthLauncherLive,
	HostedAuthService.layer,
	ServerLive,
	ArtifactSessions.layer,
	PluginCatalogService.layer,
	PluginCatalogEventsService.layer,
	PluginOperationsService.layer,
	PluginQueriesService.layer,
).pipe(Layer.provideMerge(AuthClientLive));
