import { HttpApi, OpenApi } from "@effect/platform";

import { CollectionsGroup } from "#modules/collections/contract";
import { EntitiesGroup } from "#modules/entities/contract";
import { EntityImportGroup } from "#modules/entity-import/contract";
import { EntitySchemasGroup } from "#modules/entity-schemas/contract";
import { EventSchemasGroup } from "#modules/event-schemas/contract";
import { EventsGroup } from "#modules/events/contract";
import { GodModeGroup } from "#modules/god-mode/contract";
import { ImportsGroup } from "#modules/imports/contract";
import { IntegrationsGroup } from "#modules/integrations/contract";
import { QueryEngineGroup } from "#modules/query-engine/contract";
import { RelationshipSchemasGroup } from "#modules/relationship-schemas/contract";
import { SandboxGroup } from "#modules/sandbox/contract";
import { SavedViewsGroup } from "#modules/saved-views/contract";
import { SystemGroup } from "#modules/system/contract";
import { TrackersGroup } from "#modules/trackers/contract";
import { UploadsGroup } from "#modules/uploads/contract";
import { UserStateGroup } from "#modules/user-state/contract";

export const AppContract = HttpApi.make("ryot")
	.add(SystemGroup)
	.add(SandboxGroup)
	.add(TrackersGroup)
	.add(EntitySchemasGroup)
	.add(RelationshipSchemasGroup)
	.add(EntitiesGroup)
	.add(EntityImportGroup)
	.add(UserStateGroup)
	.add(EventSchemasGroup)
	.add(EventsGroup)
	.add(UploadsGroup)
	.add(SavedViewsGroup)
	.add(CollectionsGroup)
	.add(GodModeGroup)
	.add(ImportsGroup)
	.add(IntegrationsGroup)
	.add(QueryEngineGroup)
	.annotate(OpenApi.Title, "Ryot API")
	.annotate(OpenApi.Description, "API documentation for the Ryot backend");
