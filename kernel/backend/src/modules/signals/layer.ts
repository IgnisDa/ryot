import { Layer } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";
import { RelationshipSchemasRepositoryLive } from "#modules/relationship-schemas/layer";

import { SignalSchemasService } from "./service";
import { SignalSchemasRepository } from "./signal-schemas-repository";

export const SignalSchemasRepositoryLive = SignalSchemasRepository.layer.pipe(
	Layer.provide(DefinitionRepository.layer),
);

export const SignalSchemasServiceLive = SignalSchemasService.layer.pipe(
	Layer.provide(Layer.merge(SignalSchemasRepositoryLive, RelationshipSchemasRepositoryLive)),
);
