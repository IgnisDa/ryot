import type { DbError, SandboxRunError } from "@ryot-app/contract/errors";
import type { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect } from "effect";

import type { Database } from "#lib/infrastructure/db/service";
import type { SandboxPluginRevision } from "#lib/infrastructure/sandbox-runtime/execution-principal";

export type ImportWorkflowPinningValue = {
	preRegister: (input: {
		readonly pluginId: string;
		readonly executionId: string;
		readonly executingUserId: UserId;
		readonly scriptId: SandboxScriptId;
	}) => Effect.Effect<
		{
			readonly pluginRevision: SandboxPluginRevision;
			readonly registrationStatus: "registered" | "already-registered" | "not-required";
		},
		SandboxRunError,
		Database
	>;
	release: (executionId: string) => Effect.Effect<void, DbError, Database>;
};

export class ImportWorkflowPinning extends Context.Service<
	ImportWorkflowPinning,
	ImportWorkflowPinningValue
>()("ImportWorkflowPinning") {}
