import { Layer } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";

import { RelationshipSchemasRepository } from "./repository";

export const RelationshipSchemasRepositoryLive = RelationshipSchemasRepository.layer.pipe(
	Layer.provide(DefinitionRepository.layer),
);
