import type { DbError } from "@ryot/contract/errors";
import type { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Context, type Effect } from "effect";

import type { CurrentDb } from "#lib/infrastructure/db/service";

type ActiveSandboxScript = { readonly id: SandboxScriptId };

export type SandboxPluginScriptResolverValue = {
	findActiveScriptById: (
		scriptId: SandboxScriptId,
	) => Effect.Effect<ActiveSandboxScript | null, DbError, CurrentDb>;
	findActiveWorkflowScript: (input: {
		readonly pluginSlug: string;
		readonly workflowSlug: string;
	}) => Effect.Effect<ActiveSandboxScript | null, DbError, CurrentDb>;
};

export class SandboxPluginScriptResolver extends Context.Tag("SandboxPluginScriptResolver")<
	SandboxPluginScriptResolver,
	SandboxPluginScriptResolverValue
>() {}
