import { Layer } from "effect";

import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";

import { EventSchemaReader } from "./event-schemas";
import { RelationshipSchemaReader } from "./relationship-schemas";
import { DefinitionRepository } from "./repository";

export const EventSchemaReaderLive = EventSchemaReader.layer.pipe(
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);

export const RelationshipSchemaReaderLive = RelationshipSchemaReader.layer.pipe(
	Layer.provide(DefinitionRepository.layer),
);
