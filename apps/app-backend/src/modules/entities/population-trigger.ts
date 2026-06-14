import { Context, Effect, Layer } from "effect";

import type { EntityId, EntitySchemaId, SandboxScriptId, UserId } from "#lib/schema/brands";

export type PopulationRequest = {
	entityId: EntityId;
	externalId: string;
	userId: UserId | null;
	entitySchemaId: EntitySchemaId;
	sandboxScriptId: SandboxScriptId;
};

export class EntityPopulationTrigger extends Context.Tag("EntityPopulationTrigger")<
	EntityPopulationTrigger,
	{ request: (input: PopulationRequest) => Effect.Effect<void> }
>() {}

export const EntityPopulationTriggerNoop = Layer.succeed(EntityPopulationTrigger, {
	request: () => Effect.void,
});
