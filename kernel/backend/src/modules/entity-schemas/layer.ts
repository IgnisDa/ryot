import { Layer } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";

import { EntitySchemasRepository } from "./repository";

export const EntitySchemasRepositoryLive = EntitySchemasRepository.layer.pipe(
	Layer.provide(DefinitionRepository.layer),
);
