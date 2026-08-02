import { HttpApi, OpenApi } from "effect/unstable/httpapi";

import { AutomationsGroup } from "./modules/automations/contract";
import { CollectionsGroup } from "./modules/collections/contract";
import { DefinitionsGroup } from "./modules/definitions/contract";
import { EntitiesGroup } from "./modules/entities/contract";
import { EntityImportGroup } from "./modules/entity-import/contract";
import { InterestGroup } from "./modules/entity-interest/contract";
import { EventsGroup } from "./modules/events/contract";
import { GodModeGroup } from "./modules/god-mode/contract";
import { ImportsGroup } from "./modules/imports/contract";
import { IntegrationsGroup } from "./modules/integrations/contract";
import { NotificationsGroup } from "./modules/notifications/contract";
import { PluginsGroup } from "./modules/plugins/contract";
import { QueryEngineGroup } from "./modules/query-engine/contract";
import { RelationshipsGroup } from "./modules/relationships/contract";
import { RyotQLGroup } from "./modules/ryotql/contract";
import { SavedViewsGroup } from "./modules/saved-views/contract";
import { SystemGroup } from "./modules/system/contract";
import { TestSupportGroup } from "./modules/test-support/contract";
import { LocalUploadsGroup, UploadsGroup } from "./modules/uploads/contract";
import { UserPreferencesGroup } from "./modules/user-preferences/contract";
import { UserStateGroup } from "./modules/user-state/contract";

export const AppContract = HttpApi.make("ryot")
	.add(SystemGroup)
	.add(AutomationsGroup)
	.add(DefinitionsGroup)
	.add(RelationshipsGroup)
	.add(EntitiesGroup)
	.add(EntityImportGroup)
	.add(UserStateGroup)
	.add(UserPreferencesGroup)
	.add(EventsGroup)
	.add(UploadsGroup)
	.add(LocalUploadsGroup)
	.add(SavedViewsGroup)
	.add(CollectionsGroup)
	.add(GodModeGroup)
	.add(TestSupportGroup)
	.add(ImportsGroup)
	.add(IntegrationsGroup)
	.add(QueryEngineGroup)
	.add(RyotQLGroup)
	.add(InterestGroup)
	.add(NotificationsGroup)
	.add(PluginsGroup)
	.annotate(OpenApi.Title, "Ryot API")
	.annotate(OpenApi.Description, "API documentation for the Ryot backend");
