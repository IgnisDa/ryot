import { Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import { PublicApi } from "#/api/public";
import { ManagedAssetsService } from "#/modules/assets/managed-assets";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { OAuthLauncher } from "#/modules/auth/oauth-launcher";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { ArtifactSessions } from "#/modules/plugins/artifact-sessions";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { PluginCatalogEventsService } from "#/modules/plugins/events";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { SavedViewsService } from "#/modules/saved-views/service";
import { ServerService } from "#/modules/server/service";
import { ClientStorage } from "#/persistence/storage";

const OAuthTokenLive = OAuthTokenService.layer.pipe(Layer.provideMerge(OAuthStorage.layer));
const InfrastructureLive = Layer.mergeAll(PublicApi.layer, AuthenticatedApi.layer).pipe(
	Layer.provideMerge(OAuthTokenLive),
	Layer.provideMerge(RuntimeOAuthClientService.layer),
);

const ServerLive = ServerService.layer.pipe(
	Layer.provideMerge(ClientStorage.layer),
	Layer.provideMerge(InfrastructureLive),
);
const AuthLive = AuthService.layer.pipe(
	Layer.provideMerge(ClientStorage.layer),
	Layer.provideMerge(OAuthTokenLive),
	Layer.provideMerge(RuntimeOAuthClientService.layer),
);
const OAuthLauncherLive = OAuthLauncher.layer.pipe(
	Layer.provideMerge(OAuthStorage.layer),
	Layer.provideMerge(AuthLive),
	Layer.provideMerge(ServerLive),
	Layer.provideMerge(InfrastructureLive),
	Layer.provideMerge(RuntimeOAuthClientService.layer),
);

export const ClientLive = Layer.mergeAll(
	AuthLive,
	OAuthLauncherLive,
	HostedAuthService.layer,
	ManagedAssetsService.layer,
	ServerLive,
	ArtifactSessions.layer,
	PluginCatalogService.layer,
	PluginCatalogEventsService.layer.pipe(
		Layer.provideMerge(OAuthTokenLive),
		Layer.provideMerge(RuntimeOAuthClientService.layer),
	),
	PluginOperationsService.layer,
	PluginQueriesService.layer,
	SavedViewsService.layer,
	OAuthTokenLive,
	RuntimeOAuthClientService.layer,
).pipe(Layer.provideMerge(InfrastructureLive));
