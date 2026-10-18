import type { DbError, SandboxRunError } from "@ryot-app/contract/errors";
import type {
	IngestionPins,
	IngestionPlan,
	IngestionScope,
} from "@ryot-app/contract/modules/imports/ingestion";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect } from "effect";

import type { ScriptPluginRevision } from "#modules/scripts/authorization/principal";

import type { ImportSourceState } from "./runtime/source-state";

export type ImportWorkflowPinningValue = {
	release: (executionId: string) => Effect.Effect<void, DbError>;
	preRegister: (input: {
		readonly pluginId: string;
		readonly executionId: string;
		readonly scope: IngestionScope;
		readonly executingUserId: UserId;
		readonly scriptId: SandboxScriptId;
		readonly expectedPins: IngestionPins;
		readonly accountGeneration: AccountGeneration;
		readonly preparedRelease?: {
			readonly plan: IngestionPlan;
			readonly requiresProKey: boolean;
			readonly state: Omit<ImportSourceState, "pluginRevision">;
		};
	}) => Effect.Effect<
		{
			readonly pluginRevision: ScriptPluginRevision;
			readonly registrationStatus: "registered" | "not-required" | "already-registered";
		},
		SandboxRunError
	>;
};

export class ImportWorkflowPinning extends Context.Service<
	ImportWorkflowPinning,
	ImportWorkflowPinningValue
>()("ImportWorkflowPinning") {}
