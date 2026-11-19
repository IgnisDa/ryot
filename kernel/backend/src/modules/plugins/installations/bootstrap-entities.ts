import type { InternalError } from "@ryot-app/contract/errors";
import type { PluginUserBootstrapEntity } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect, Schema } from "effect";

export type PluginBootstrapEntitiesInput = {
	readonly userId: UserId;
	readonly entrySlug: string;
	readonly installedAt: Date;
	readonly pluginId: PluginId;
	readonly executionId: string;
	readonly accountUserId: UserId;
	readonly installationId: string;
	readonly entities: ReadonlyArray<PluginUserBootstrapEntity>;
};

/** Hook dispatch plans of ensured writes, opaque to their caller. */
export const PluginBootstrapDispatch = Schema.Array(Schema.Unknown);
export type PluginBootstrapDispatch = typeof PluginBootstrapDispatch.Type;

/**
 * Writes the entities a user bootstrap entry declares, in the kernel's name. `ensure` commits from an
 * activity; `dispatch` then starts the hook runs those writes planned and must run in a workflow body.
 */
export class PluginBootstrapEntities extends Context.Service<
	PluginBootstrapEntities,
	{
		readonly dispatch: (plans: PluginBootstrapDispatch) => Effect.Effect<void, InternalError>;
		readonly ensure: (
			input: PluginBootstrapEntitiesInput,
		) => Effect.Effect<PluginBootstrapDispatch, InternalError>;
	}
>()(
	"@ryot-app/kernel-backend/modules/plugins/installations/bootstrap-entities/PluginBootstrapEntities",
) {}
