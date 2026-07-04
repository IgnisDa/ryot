import type { DbError, SandboxRunError } from "@ryot/contract/errors";
import type { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Context, type Effect } from "effect";

import type { Database } from "#lib/infrastructure/db/service";

export type ImportWorkflowPinningValue = {
	preRegister: (input: {
		readonly pluginSlug: string;
		readonly executionId: string;
		readonly executingUserId: UserId;
		readonly scriptId: SandboxScriptId;
	}) => Effect.Effect<
		{ readonly registrationStatus: "registered" | "already-registered" | "not-required" },
		SandboxRunError,
		Database
	>;
	release: (executionId: string) => Effect.Effect<void, DbError, Database>;
};

export class ImportWorkflowPinning extends Context.Service<
	ImportWorkflowPinning,
	ImportWorkflowPinningValue
>()("ImportWorkflowPinning") {}
