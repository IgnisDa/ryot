import { Layer } from "effect";

import { RelationshipSchemaReaderLive } from "#modules/definitions/layer";
import { DefinitionRepository } from "#modules/definitions/repository";

import { SignalSchemasService } from "./service";
import { SignalSchemasRepository } from "./signal-schemas-repository";

export const SignalSchemasRepositoryLive = SignalSchemasRepository.layer.pipe(
	Layer.provide(DefinitionRepository.layer),
);

export const SignalSchemasServiceLive = SignalSchemasService.layer.pipe(
	Layer.provide(Layer.merge(SignalSchemasRepositoryLive, RelationshipSchemaReaderLive)),
);
