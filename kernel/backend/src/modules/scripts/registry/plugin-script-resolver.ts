import type { DbError } from "@ryot-app/contract/errors";
import type { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect } from "effect";

export type SandboxPluginScriptResolverValue = {
	findActiveScriptById: (
		scriptId: SandboxScriptId,
		executingUserId: null | UserId,
	) => Effect.Effect<null | ActiveSandboxScript, DbError>;
	findWorkflowScriptAvailableToUser: (
		userId: UserId,
		pluginId: string,
		workflowSlug: string,
		pluginInstallationId: string,
	) => Effect.Effect<null | ActiveSandboxScript, DbError>;
};

type ActiveSandboxScript = { readonly id: SandboxScriptId };

export class SandboxPluginScriptResolver extends Context.Service<
	SandboxPluginScriptResolver,
	SandboxPluginScriptResolverValue
>()("SandboxPluginScriptResolver") {}
