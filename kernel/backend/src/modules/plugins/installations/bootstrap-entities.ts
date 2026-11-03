import type { InternalError } from "@ryot-app/contract/errors";
import type { PluginUserBootstrapEntity } from "@ryot-app/contract/modules/plugins/manifest";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect } from "effect";

export type PluginBootstrapEntitiesInput = {
	readonly userId: UserId;
	readonly entrySlug: string;
	readonly installedAt: Date;
	readonly pluginId: PluginId;
	readonly executionId: string;
	readonly installationId: string;
	readonly accountGeneration: AccountGeneration;
	readonly entities: ReadonlyArray<PluginUserBootstrapEntity>;
};

/** Writes the entities a user bootstrap entry declares, in the kernel's name. */
export class PluginBootstrapEntities extends Context.Service<
	PluginBootstrapEntities,
	{ readonly ensure: (input: PluginBootstrapEntitiesInput) => Effect.Effect<void, InternalError> }
>()(
	"@ryot-app/kernel-backend/modules/plugins/installations/bootstrap-entities/PluginBootstrapEntities",
) {}
