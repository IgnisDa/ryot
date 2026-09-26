import type { DbError } from "@ryot-app/contract/errors";
import type { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect } from "effect";

import type { Database } from "#lib/infrastructure/db/service";

type ActiveSandboxScript = { readonly id: SandboxScriptId };

export type SandboxPluginScriptResolverValue = {
	findActiveScriptById: (
		scriptId: SandboxScriptId,
	) => Effect.Effect<ActiveSandboxScript | null, DbError, Database>;
	findWorkflowScriptAvailableToUser: (
		userId: UserId,
		pluginId: string,
		workflowSlug: string,
		pluginInstallationId: string,
	) => Effect.Effect<ActiveSandboxScript | null, DbError, Database>;
};

export class SandboxPluginScriptResolver extends Context.Service<
	SandboxPluginScriptResolver,
	SandboxPluginScriptResolverValue
>()("SandboxPluginScriptResolver") {}
