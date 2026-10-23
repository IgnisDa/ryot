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
	| typeof SystemGroup
	| typeof AutomationsGroup
	| typeof AutomationHistoryGroup
	| typeof BackupsGroup
	| typeof BackupDownloadsGroup
	| typeof RelationshipsGroup
	| typeof EntitiesGroup
	| typeof EntityProvidersGroup
	| typeof EntityUserDataGroup
	| typeof AccountGroup
	| typeof EventsGroup
	| typeof UploadsGroup
	| typeof LocalUploadsGroup
	| typeof SavedViewsGroup
	| typeof CalendarSourcesGroup
	| typeof CollectionsGroup
	| typeof PagesGroup
	| typeof PageBundlesGroup
	| typeof InstanceAdminGroup
	| typeof ServerLogsGroup
	| typeof ServerLogDownloadsGroup
	| typeof TestSupportGroup
	| typeof ImportsGroup
	| typeof ImportDownloadsGroup
	| typeof IntegrationsGroup
	| typeof OAuthConnectionsGroup
	| typeof RyotQLGroup
	| typeof AdminRyotQLGroup
	| typeof EntityWatchesGroup
	| typeof NotificationsGroup
	| typeof PluginsGroup;

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
