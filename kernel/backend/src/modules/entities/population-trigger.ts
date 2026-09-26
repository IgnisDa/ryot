import type {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { Effect } from "effect";
import { Context } from "effect";

import type { LifecycleCommand } from "#lib/domain/lifecycle-command";

export type PopulationRequest = {
	entityId: EntityId;
	command: LifecycleCommand;
	externalId: string;
	userId: UserId | null;
	providerId: SandboxProviderId;
	entitySchemaSlug: EntitySchemaSlug;
};

export class EntityPopulationTrigger extends Context.Service<
	EntityPopulationTrigger,
	{ request: (input: PopulationRequest) => Effect.Effect<void> }
>()("EntityPopulationTrigger") {}
