import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Context, type Effect } from "effect";

import type { DomainLifecycleCommand } from "./write-context";

export const entityPopulationExecutionId = (
	entityId: EntityId,
	accountGeneration: AccountGeneration | null,
) => `populate-${entityId}${accountGeneration === null ? "" : `-${accountGeneration.token}`}`;

export type PopulationRequest = {
	entityId: EntityId;
	command: DomainLifecycleCommand;
	entitySchemaPluginId: string | null;
	externalId: string;
	userId: UserId | null;
	providerId: SandboxProviderId;
	entitySchemaSlug: EntitySchemaSlug;
};

export class EntityPopulationTrigger extends Context.Service<
	EntityPopulationTrigger,
	{ request: (input: PopulationRequest) => Effect.Effect<void> }
>()("EntityPopulationTrigger") {}
