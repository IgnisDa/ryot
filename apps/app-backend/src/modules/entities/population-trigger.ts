import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import type {
	EntityId,
	EntitySchemaSlug,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

export type PopulationRequest = {
	entityId: EntityId;
	externalId: string;
	userId: UserId | null;
	origin: AutomationOrigin;
	entitySchemaSlug: EntitySchemaSlug;
	sandboxScriptId: SandboxScriptId;
};

export class EntityPopulationTrigger extends Context.Tag("EntityPopulationTrigger")<
	EntityPopulationTrigger,
	{ request: (input: PopulationRequest) => Effect.Effect<void> }
>() {}

export const EntityPopulationTriggerNoop = Layer.succeed(EntityPopulationTrigger, {
	request: () => Effect.void,
});
