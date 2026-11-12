import { Layer } from "effect";
import { SecureRandom } from "effect/crypto";
import { FetchHttpClient } from "effect/http";

import { AccountApi } from "#/api/account";
import { AdminApi } from "#/api/admin";
import { AssistantApi } from "#/api/assistant";
import { AuthenticatedApi } from "#/api/authenticated";
import { AutomationsApi } from "#/api/automations";
import { BackupsApi } from "#/api/backups";
import { CalendarSourcesApi } from "#/api/calendar-sources";
import { CollectionsApi } from "#/api/collections";
import { EntityProvidersApi } from "#/api/entity-providers";
import { EventsApi } from "#/api/events";
import { ImportsApi } from "#/api/imports";
import { InstanceAdminApi } from "#/api/instance-admin";
import { IntegrationsApi } from "#/api/integrations";
import { LiveUpdatesApi } from "#/api/live-updates";
import { NotificationsApi } from "#/api/notifications";
import { OAuthConnectionsApi } from "#/api/oauth-connections";
import { PagesApi } from "#/api/pages";
import { PluginInstallationsApi } from "#/api/plugin-installations";
import { PluginsApi } from "#/api/plugins";
import { PublicApi } from "#/api/public";
import { PublicationsApi, PublicationVisitsApi } from "#/api/publications";
import { RemindersApi } from "#/api/reminders";
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
	Layer.provide(SecureRandom.layerWebCrypto),
);

export const ApiLive = Layer.mergeAll(
	AssistantApi.layer,
	AutomationsApi.layer,
	PublicApi.layer,
	LiveUpdatesApi.layer,
	RyotQLApi.layer,
	BackupsApi.layer,
	PagesApi.layer,
	CollectionsApi.layer,
	EventsApi.layer,
	CalendarSourcesApi.layer,
	UploadsApi.layer,
	PluginsApi.layer,
	ImportsApi.layer,
	InstanceAdminApi.layer,
	SavedViewsApi.layer,
	AccountApi.layer,
	IntegrationsApi.layer,
	NotificationsApi.layer,
	RemindersApi.layer,
	OAuthConnectionsApi.layer,
	EntityProvidersApi.layer,
	PluginInstallationsApi.layer,
	PublicationsApi.layer,
	PublicationVisitsApi.layer,
).pipe(Layer.provide(TransportLive));
