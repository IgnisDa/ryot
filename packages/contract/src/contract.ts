import { HttpApi, OpenApi } from "effect/http-api";

import { AccountGroup } from "./modules/account/contract";
import { LocalUploadsGroup, UploadsGroup } from "./modules/assets/contract";
import { AutomationHistoryGroup, AutomationsGroup } from "./modules/automations/contract";
import { BackupDownloadsGroup, BackupsGroup } from "./modules/backups/contract";
import { CalendarSourcesGroup } from "./modules/calendar-sources/contract";
import { CollectionsGroup } from "./modules/collections/contract";
import { EntitiesGroup } from "./modules/entities/contract";
import { EntityProvidersGroup } from "./modules/entity-providers/contract";
import { EntityUserDataGroup } from "./modules/entity-user-data/contract";
import { EntityWatchesGroup } from "./modules/entity-watches/contract";
import { EventsGroup } from "./modules/events/contract";
import { ImportDownloadsGroup, ImportsGroup } from "./modules/imports/contract";
import { InstanceAdminGroup } from "./modules/instance-admin/contract";
import { ServerLogDownloadsGroup, ServerLogsGroup } from "./modules/instance-admin/logs";
import { IntegrationsGroup } from "./modules/integrations/contract";
import { NotificationsGroup } from "./modules/notifications/contract";
import { OAuthConnectionsGroup } from "./modules/oauth-connections/contract";
import { PageBundlesGroup, PagesGroup } from "./modules/pages/contract";
import { PluginsGroup } from "./modules/plugins/contract";
import { RelationshipsGroup } from "./modules/relationships/contract";
import { AdminRyotQLGroup, RyotQLGroup } from "./modules/ryotql/contract";
import { SavedViewsGroup } from "./modules/saved-views/contract";
import { SystemGroup } from "./modules/system/contract";
import { TestSupportGroup } from "./modules/test-support/contract";

export type AppGroups =
	| typeof PagesGroup
	| typeof SystemGroup
	| typeof EventsGroup
	| typeof RyotQLGroup
	| typeof BackupsGroup
	| typeof AccountGroup
	| typeof UploadsGroup
	| typeof ImportsGroup
	| typeof PluginsGroup
	| typeof EntitiesGroup
	| typeof SavedViewsGroup
	| typeof ServerLogsGroup
	| typeof AutomationsGroup
	| typeof CollectionsGroup
	| typeof PageBundlesGroup
	| typeof TestSupportGroup
	| typeof AdminRyotQLGroup
	| typeof LocalUploadsGroup
	| typeof IntegrationsGroup
	| typeof RelationshipsGroup
	| typeof InstanceAdminGroup
	| typeof EntityWatchesGroup
	| typeof NotificationsGroup
	| typeof EntityUserDataGroup
	| typeof BackupDownloadsGroup
	| typeof EntityProvidersGroup
	| typeof CalendarSourcesGroup
	| typeof ImportDownloadsGroup
	| typeof OAuthConnectionsGroup
	| typeof AutomationHistoryGroup
	| typeof ServerLogDownloadsGroup;

export const AppContract: HttpApi.HttpApi<"ryot", AppGroups> = HttpApi.make("ryot")
	.add(SystemGroup)
	.add(AutomationsGroup)
	.add(AutomationHistoryGroup)
	.add(BackupsGroup)
	.add(BackupDownloadsGroup)
	.add(RelationshipsGroup)
	.add(EntitiesGroup)
	.add(EntityProvidersGroup)
	.add(EntityUserDataGroup)
	.add(AccountGroup)
	.add(EventsGroup)
	.add(UploadsGroup)
	.add(LocalUploadsGroup)
	.add(SavedViewsGroup)
	.add(CalendarSourcesGroup)
	.add(CollectionsGroup)
	.add(PagesGroup)
	.add(PageBundlesGroup)
	.add(InstanceAdminGroup)
	.add(ServerLogsGroup)
	.add(ServerLogDownloadsGroup)
	.add(TestSupportGroup)
	.add(ImportsGroup)
	.add(ImportDownloadsGroup)
	.add(IntegrationsGroup)
	.add(OAuthConnectionsGroup)
	.add(RyotQLGroup)
	.add(AdminRyotQLGroup)
	.add(EntityWatchesGroup)
	.add(NotificationsGroup)
	.add(PluginsGroup)
	.annotate(OpenApi.Title, "Ryot API")
	.annotate(OpenApi.Description, "API documentation for the Ryot backend");
