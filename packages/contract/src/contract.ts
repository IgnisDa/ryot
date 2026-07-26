import { HttpApi, OpenApi } from "effect/unstable/httpapi";

import {
	AutomationHistoryGroup,
	AutomationsGroup,
	GodModeAutomationHistoryGroup,
} from "./modules/automations/contract";
import { BackupsGroup } from "./modules/backups/contract";
import { ClientPageArtifactsGroup, ClientPagesGroup } from "./modules/client-pages/contract";
import { CollectionsGroup } from "./modules/collections/contract";
import { DefinitionsGroup } from "./modules/definitions/contract";
import { EntitiesGroup } from "./modules/entities/contract";
import { InterestGroup } from "./modules/entity-interest/contract";
import { EventsGroup } from "./modules/events/contract";
import { GodModeGroup } from "./modules/god-mode/contract";
import { ImportsGroup } from "./modules/imports/contract";
import { IntegrationsGroup } from "./modules/integrations/contract";
import { NotificationsGroup } from "./modules/notifications/contract";
import { PluginsGroup } from "./modules/plugins/contract";
import { ProviderEntitiesGroup } from "./modules/provider-entities/contract";
import { RelationshipsGroup } from "./modules/relationships/contract";
import { RyotQLGroup } from "./modules/ryotql/contract";
import { SavedViewsGroup } from "./modules/saved-views/contract";
import { SystemGroup } from "./modules/system/contract";
import { TestSupportGroup } from "./modules/test-support/contract";
import { LocalUploadsGroup, UploadsGroup } from "./modules/uploads/contract";
import { UserSettingsGroup } from "./modules/user-settings/contract";
import { UserStateGroup } from "./modules/user-state/contract";

export type AppGroups =
	| typeof SystemGroup
	| typeof AutomationsGroup
	| typeof AutomationHistoryGroup
	| typeof GodModeAutomationHistoryGroup
	| typeof BackupsGroup
	| typeof DefinitionsGroup
	| typeof RelationshipsGroup
	| typeof EntitiesGroup
	| typeof ProviderEntitiesGroup
	| typeof UserStateGroup
	| typeof UserSettingsGroup
	| typeof EventsGroup
	| typeof UploadsGroup
	| typeof LocalUploadsGroup
	| typeof SavedViewsGroup
	| typeof CollectionsGroup
	| typeof ClientPagesGroup
	| typeof ClientPageArtifactsGroup
	| typeof GodModeGroup
	| typeof TestSupportGroup
	| typeof ImportsGroup
	| typeof IntegrationsGroup
	| typeof RyotQLGroup
	| typeof InterestGroup
	| typeof NotificationsGroup
	| typeof PluginsGroup;

export const AppContract: HttpApi.HttpApi<"ryot", AppGroups> = HttpApi.make("ryot")
	.add(SystemGroup)
	.add(AutomationsGroup)
	.add(AutomationHistoryGroup)
	.add(GodModeAutomationHistoryGroup)
	.add(BackupsGroup)
	.add(DefinitionsGroup)
	.add(RelationshipsGroup)
	.add(EntitiesGroup)
	.add(ProviderEntitiesGroup)
	.add(UserStateGroup)
	.add(UserSettingsGroup)
	.add(EventsGroup)
	.add(UploadsGroup)
	.add(LocalUploadsGroup)
	.add(SavedViewsGroup)
	.add(CollectionsGroup)
	.add(ClientPagesGroup)
	.add(ClientPageArtifactsGroup)
	.add(GodModeGroup)
	.add(TestSupportGroup)
	.add(ImportsGroup)
	.add(IntegrationsGroup)
	.add(RyotQLGroup)
	.add(InterestGroup)
	.add(NotificationsGroup)
	.add(PluginsGroup)
	.annotate(OpenApi.Title, "Ryot API")
	.annotate(OpenApi.Description, "API documentation for the Ryot backend");
