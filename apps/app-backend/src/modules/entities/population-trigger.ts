import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import type {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot/contract/schema/brands";
import type { Effect } from "effect";
import { Context } from "effect";

export type PopulationRequest = {
	entityId: EntityId;
	externalId: string;
	userId: UserId | null;
	origin: AutomationOrigin;
	providerId: SandboxProviderId;
	entitySchemaSlug: EntitySchemaSlug;
};

export class EntityPopulationTrigger extends Context.Service<
	EntityPopulationTrigger,
	{ request: (input: PopulationRequest) => Effect.Effect<void> }
>()("EntityPopulationTrigger") {}
