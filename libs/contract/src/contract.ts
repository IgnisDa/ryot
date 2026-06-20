import { HttpApi, OpenApi } from "@effect/platform";

import { BadRequest } from "./errors";
import { AutomationsGroup } from "./modules/automations/contract";
import { CollectionsGroup } from "./modules/collections/contract";
import { EntitiesGroup } from "./modules/entities/contract";
import { InterestGroup } from "./modules/entity-interest/contract";
import { EntitySchemasGroup } from "./modules/entity-schemas/contract";
import { EventSchemasGroup } from "./modules/event-schemas/contract";
import { EventsGroup } from "./modules/events/contract";
import { GodModeGroup } from "./modules/god-mode/contract";
import { ImportsGroup } from "./modules/imports/contract";
import { IntegrationsGroup } from "./modules/integrations/contract";
import { EntityImportGroup } from "./modules/library-membership/contract";
import { MediaMonitoringGroup } from "./modules/media-monitoring/contract";
import { MetadataLookupGroup } from "./modules/metadata-lookup/contract";
import { NotificationsGroup } from "./modules/notifications/contract";
import { QueryEngineGroup } from "./modules/query-engine/contract";
import { RelationshipSchemasGroup } from "./modules/relationship-schemas/contract";
import { RelationshipsGroup } from "./modules/relationships/contract";
import { SandboxGroup } from "./modules/sandbox/contract";
import { SavedViewsGroup } from "./modules/saved-views/contract";
import { SystemGroup } from "./modules/system/contract";
import { TestSupportGroup } from "./modules/test-support/contract";
import { TrackersGroup } from "./modules/trackers/contract";
import { UploadsGroup } from "./modules/uploads/contract";
import { UserPreferencesGroup } from "./modules/user-preferences/contract";
import { UserStateGroup } from "./modules/user-state/contract";

export const AppContract = HttpApi.make("ryot")
	.addError(BadRequest, { status: 400 })
	.add(SystemGroup)
	.add(AutomationsGroup)
	.add(SandboxGroup)
	.add(TrackersGroup)
	.add(EntitySchemasGroup)
	.add(RelationshipSchemasGroup)
	.add(RelationshipsGroup)
	.add(EntitiesGroup)
	.add(EntityImportGroup)
	.add(UserStateGroup)
	.add(UserPreferencesGroup)
	.add(EventSchemasGroup)
	.add(EventsGroup)
	.add(UploadsGroup)
	.add(SavedViewsGroup)
	.add(CollectionsGroup)
	.add(GodModeGroup)
	.add(TestSupportGroup)
	.add(ImportsGroup)
	.add(IntegrationsGroup)
	.add(MetadataLookupGroup)
	.add(QueryEngineGroup)
	.add(InterestGroup)
	.add(MediaMonitoringGroup)
	.add(NotificationsGroup)
	.annotate(OpenApi.Title, "Ryot API")
	.annotate(OpenApi.Description, "API documentation for the Ryot backend");
