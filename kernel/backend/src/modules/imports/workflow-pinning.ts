import type { DbError, SandboxRunError } from "@ryot-app/contract/errors";
import type {
	IngestionPins,
	IngestionScope,
	IngestionPlan,
} from "@ryot-app/contract/modules/imports/ingestion";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect } from "effect";

import type { SandboxPluginRevision } from "#lib/infrastructure/sandbox-runtime/execution-principal";

import type { ImportSourceState } from "./runtime/source-state";

export type ImportWorkflowPinningValue = {
	preRegister: (input: {
		readonly scope: IngestionScope;
		readonly pluginId: string;
		readonly executionId: string;
		readonly executingUserId: UserId;
		readonly accountGeneration: AccountGeneration;
		readonly scriptId: SandboxScriptId;
		readonly expectedPins: IngestionPins;
		readonly preparedRelease?: {
			readonly plan: IngestionPlan;
			readonly requiresProKey: boolean;
			readonly state: Omit<ImportSourceState, "pluginRevision">;
		};
	}) => Effect.Effect<
		{
			readonly pluginRevision: SandboxPluginRevision;
			readonly registrationStatus: "registered" | "already-registered" | "not-required";
		},
		SandboxRunError
	>;
	release: (executionId: string) => Effect.Effect<void, DbError>;
};

export class ImportWorkflowPinning extends Context.Service<
	ImportWorkflowPinning,
	ImportWorkflowPinningValue
>()("ImportWorkflowPinning") {}
