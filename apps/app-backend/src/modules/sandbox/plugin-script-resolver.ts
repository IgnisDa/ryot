import type { DbError } from "@ryot/contract/errors";
import type { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Context, type Effect } from "effect";

import type { Database } from "#lib/infrastructure/db/service";

type ActiveSandboxScript = { readonly id: SandboxScriptId };

export type SandboxPluginScriptResolverValue = {
	findActiveScriptById: (
		scriptId: SandboxScriptId,
	) => Effect.Effect<ActiveSandboxScript | null, DbError, Database>;
	findActiveWorkflowScript: (input: {
		readonly pluginSlug: string;
		readonly workflowSlug: string;
	}) => Effect.Effect<ActiveSandboxScript | null, DbError, Database>;
};

/** @effect-expect-leaking Database */
export class SandboxPluginScriptResolver extends Context.Service<
	SandboxPluginScriptResolver,
	SandboxPluginScriptResolverValue
>()("SandboxPluginScriptResolver") {}
