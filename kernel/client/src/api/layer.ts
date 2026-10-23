import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";

import { AccountApi } from "#/api/account";
import { AdminApi } from "#/api/admin";
import { AuthenticatedApi } from "#/api/authenticated";
import { AutomationHistoryApi } from "#/api/automation-history";
import { BackupsApi } from "#/api/backups";
import { CalendarSourcesApi } from "#/api/calendar-sources";
import { CollectionsApi } from "#/api/collections";
import { EntityProvidersApi } from "#/api/entity-providers";
import { EntityWatchApi } from "#/api/entity-watches";
import { ImportsApi } from "#/api/imports";
import { InstanceAdminApi } from "#/api/instance-admin";
import { IntegrationsApi } from "#/api/integrations";
import { NotificationsApi } from "#/api/notifications";
import { OAuthConnectionsApi } from "#/api/oauth-connections";
import { PagesApi } from "#/api/pages";
import { PluginInstallationsApi } from "#/api/plugin-installations";
import { PluginsApi } from "#/api/plugins";
import { PublicApi } from "#/api/public";
import { RyotQLApi } from "#/api/ryotql";
import { SavedViewsApi } from "#/api/saved-views";
import { UploadsApi } from "#/api/uploads";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { FileDownloads } from "#/modules/downloads/file";

export const TransportLive = Layer.mergeAll(
	AdminApi.layer.pipe(Layer.provide(FileDownloads.layer)),
	AuthenticatedApi.layer,
	FileDownloads.layer,
).pipe(
	Layer.provideMerge(OAuthTokenService.layer),
	Layer.provideMerge(RuntimeOAuthClientService.layer),
	Layer.provideMerge(FetchHttpClient.layer),
);

export const ApiLive = Layer.mergeAll(
	PublicApi.layer,
	AutomationHistoryApi.layer,
	EntityWatchApi.layer,
	RyotQLApi.layer,
	BackupsApi.layer,
	PagesApi.layer,
	CollectionsApi.layer,
	CalendarSourcesApi.layer,
	UploadsApi.layer,
	PluginsApi.layer,
	ImportsApi.layer,
	InstanceAdminApi.layer,
	SavedViewsApi.layer,
	AccountApi.layer,
	IntegrationsApi.layer,
	NotificationsApi.layer,
	OAuthConnectionsApi.layer,
	EntityProvidersApi.layer,
	PluginInstallationsApi.layer,
).pipe(Layer.provide(TransportLive));
